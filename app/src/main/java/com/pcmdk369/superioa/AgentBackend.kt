package com.pcmdk369.superioa

import com.pcmdk369.superioa.core.ActionValidator
import com.pcmdk369.superioa.core.AgentPlan
import com.pcmdk369.superioa.core.PlanValidation
import com.pcmdk369.superioa.core.ProposedAction
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class AgentPlanResult(
    val taskId: String,
    val engineId: String,
    val plan: AgentPlan,
)

object AgentBackend {
    fun signIn(projectUrl: String, anonKey: String, email: String, password: String): String {
        val baseUrl = validatedBaseUrl(projectUrl)
        val response = request(
            "$baseUrl/auth/v1/token?grant_type=password",
            "POST",
            mapOf("apikey" to anonKey, "Content-Type" to "application/json"),
            JSONObject().put("email", email).put("password", password).toString(),
        )
        val session = JSONObject(response)
        return session.optString("access_token").takeIf(String::isNotBlank)
            ?: throw IllegalStateException("Supabase Auth did not return an access token.")
    }

    fun plan(
        projectUrl: String,
        anonKey: String,
        accessToken: String,
        task: String,
        screenContext: String?,
    ): AgentPlanResult {
        val baseUrl = validatedBaseUrl(projectUrl)
        val body = JSONObject()
            .put("task", task)
            .put("screenContext", screenContext.orEmpty())
            .put("mode", "plan")
        val result = JSONObject(
            request(
                "$baseUrl/functions/v1/agent-execute",
                "POST",
                mapOf(
                    "apikey" to anonKey,
                    "Authorization" to "Bearer $accessToken",
                    "Content-Type" to "application/json",
                ),
                body.toString(),
            ),
        )
        val planJson = result.getJSONObject("plan")
        return AgentPlanResult(
            taskId = result.optString("taskId").ifBlank { "local-task" },
            engineId = result.optString("engineId").ifBlank { "unknown" },
            plan = parsePlan(planJson),
        )
    }

    fun deleteAccount(projectUrl: String, anonKey: String, accessToken: String) {
        val baseUrl = validatedBaseUrl(projectUrl)
        val response = request(
            "$baseUrl/functions/v1/agent-execute",
            "POST",
            mapOf(
                "apikey" to anonKey,
                "Authorization" to "Bearer $accessToken",
                "Content-Type" to "application/json",
            ),
            JSONObject().put("mode", "delete-account").toString(),
        )
        if (!JSONObject(response).optBoolean("deleted")) {
            throw IllegalStateException("The account deletion was not confirmed by the backend.")
        }
    }

    fun parsePlan(json: JSONObject): AgentPlan {
        val proposed = mutableListOf<ProposedAction>()
        val actions: JSONArray = json.getJSONArray("actions")
        for (index in 0 until actions.length()) {
            val action = actions.getJSONObject(index)
            val actionName = action.get("action") as? String
                ?: throw IllegalStateException("Action ${index + 1} has an invalid type.")
            val recommendationType = action.get("recommendationType") as? String
                ?: throw IllegalStateException("Action ${index + 1} is missing its recommendation type.")
            val target = action.getNullableString("target")
            val text = action.getNullableString("text")
            val timeoutValue = if (action.has("timeoutMs")) action.get("timeoutMs") else null
            val timeout = when (timeoutValue) {
                null, JSONObject.NULL -> null
                is Number -> timeoutValue.toInt().takeIf { timeoutValue.toDouble() == it.toDouble() }
                    ?: throw IllegalStateException("Action ${index + 1} has an invalid timeout.")
                else -> throw IllegalStateException("Action ${index + 1} has an invalid timeout.")
            }
            val approvalValue = if (action.has("requiresApproval")) action.get("requiresApproval") else false
            val requiresApproval = approvalValue as? Boolean
                ?: throw IllegalStateException("Action ${index + 1} has an invalid approval flag.")
            proposed += ProposedAction(
                action = actionName,
                target = target,
                text = text,
                timeoutMs = timeout,
                requiresApproval = requiresApproval,
                approvalReason = action.getNullableString("approvalReason"),
                recommendationType = recommendationType,
                recommendation = action.getNullableString("recommendation"),
                agent = action.getNullableString("agent"),
                subAgent = action.getNullableString("subAgent"),
                skill = action.getNullableString("skill"),
            )
        }
        val validated = when (val result = ActionValidator.validate(proposed)) {
            is PlanValidation.Valid -> result.plan
            is PlanValidation.Invalid -> throw IllegalStateException("The action plan was rejected: ${result.reason}")
        }
        return AgentPlan(
            summary = json.requireString("summary"),
            domain = json.requireString("domain"),
            agent = json.requireString("agent"),
            subAgent = json.requireString("subAgent"),
            preSubAgent = json.getNullableString("preSubAgent"),
            skill = json.requireString("skill"),
            expectedResult = json.requireString("expectedResult"),
            actions = validated,
        )
    }

    private fun JSONObject.getNullableString(name: String): String? {
        if (!has(name) || isNull(name)) return null
        return get(name) as? String ?: throw IllegalStateException("Action plan field '$name' must be text.")
    }

    private fun JSONObject.requireString(name: String): String =
        get(name) as? String ?: throw IllegalStateException("Action plan field '$name' must be text.")

    private fun validatedBaseUrl(value: String): String {
        val url = value.trim().trimEnd('/')
        require(url.startsWith("https://", ignoreCase = true)) { "Supabase project URL must use HTTPS." }
        return url
    }

    private fun request(
        address: String,
        method: String,
        headers: Map<String, String>,
        body: String,
    ): String {
        val connection = URL(address).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = REQUEST_TIMEOUT_MS
            connection.readTimeout = REQUEST_TIMEOUT_MS
            connection.doOutput = true
            headers.forEach(connection::setRequestProperty)
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val content = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IllegalStateException(errorMessage(status, content))
            return content
        } finally {
            connection.disconnect()
        }
    }

    private fun errorMessage(status: Int, responseBody: String): String {
        val error = try {
            JSONObject(responseBody).optString("error")
        } catch (_: JSONException) {
            ""
        }
        return when (error) {
            "authentication_required" -> "Sign in to Supabase before planning."
            "invalid_session" -> "Your Supabase session expired. Sign in again."
            "no_llm_engines_configured" -> "No LLM engines are configured on the trusted backend."
            "plan_rate_limit_exceeded" -> "Too many planning requests. Wait one minute and try again."
            "rate_limit_unavailable" -> "The request limit could not be checked. Planning is temporarily unavailable."
            "all_llm_engines_failed" -> "All configured LLM engines failed. Check server settings and retry."
            "usage_logging_unavailable" -> "Usage logging is unavailable. The plan was not returned."
            "account_deletion_failed" -> "Account deletion could not be confirmed. Local data was kept; check your account before retrying."
            "backend_not_configured" -> "The SuperiOA backend is not configured yet."
            else -> when (status) {
                400 -> "The backend rejected the task or returned an invalid plan."
                401 -> "Authentication failed. Sign in again."
                403 -> "The backend rejected this app's origin."
                502, 503 -> "The SuperiOA backend is unavailable. Check its configuration and retry."
                else -> "The SuperiOA request failed (HTTP $status)."
            }
        }
    }

    private const val REQUEST_TIMEOUT_MS = 25_000
}
