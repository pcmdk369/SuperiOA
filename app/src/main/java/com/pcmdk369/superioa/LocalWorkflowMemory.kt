package com.pcmdk369.superioa

import android.content.SharedPreferences
import com.pcmdk369.superioa.core.AgentPlan
import com.pcmdk369.superioa.core.WorkflowRecord
import com.pcmdk369.superioa.core.WorkflowReusePolicy
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import java.security.MessageDigest

class LocalWorkflowMemory(private val preferences: SharedPreferences) {
    fun find(task: String, appContext: String): AgentPlanResult? {
        val record = read(task) ?: return null
        val steps = record.plan.actions.actions
        val workflow = WorkflowRecord(
            id = record.taskId,
            version = record.version,
            appContext = record.appContext,
            steps = steps,
            successCount = record.successCount,
            failureCount = record.failureCount,
            confidence = record.confidence,
            enabled = record.enabled,
            lastUsedEpochMs = record.lastValidated,
        )
        return if (WorkflowReusePolicy.canReuse(workflow, appContext)) record.plan else null
    }

    fun recordSuccess(task: String, appContext: String, result: AgentPlanResult) {
        val previous = read(task)
        val successes = (previous?.successCount ?: 0) + 1
        val failures = previous?.failureCount ?: 0
        write(
            task,
            Record(
                plan = result,
                appContext = appContext,
                version = (previous?.version ?: 0) + 1,
                successCount = successes,
                failureCount = failures,
                confidence = successes.toDouble() / (successes + failures),
                enabled = true,
                lastValidated = System.currentTimeMillis(),
            ),
        )
    }

    fun recordFailure(task: String) {
        val previous = read(task) ?: return
        val failures = previous.failureCount + 1
        val total = previous.successCount + failures
        write(
            task,
            previous.copy(
                failureCount = failures,
                confidence = previous.successCount.toDouble() / total,
                enabled = previous.successCount.toDouble() / total >= MIN_CONFIDENCE,
            ),
        )
    }

    private fun read(task: String): Record? {
        val value = preferences.getString(key(task), null) ?: return null
        try {
            val json = JSONObject(value)
            val plan = AgentBackend.parsePlan(json.getJSONObject("plan").getJSONObject("content"))
            val planResult = AgentPlanResult(
                taskId = json.getString("id"),
                engineId = json.getString("engineId"),
                plan = plan,
            )
            Record(
                plan = planResult,
                appContext = json.getString("appContext"),
                version = json.getInt("version"),
                successCount = json.getInt("successCount"),
                failureCount = json.getInt("failureCount"),
                confidence = json.getDouble("confidence"),
                enabled = json.getBoolean("enabled"),
                lastValidated = json.getLong("lastValidated"),
            )
        } catch (failure: JSONException) {
            throw IllegalStateException("Saved local workflow data is invalid.", failure)
        }
    }

    private fun write(task: String, record: Record) {
        preferences.edit().putString(key(task), JSONObject()
            .put("id", record.plan.taskId)
            .put("engineId", record.plan.engineId)
            .put("appContext", record.appContext)
            .put("version", record.version)
            .put("successCount", record.successCount)
            .put("failureCount", record.failureCount)
            .put("confidence", record.confidence)
            .put("enabled", record.enabled)
            .put("lastValidated", record.lastValidated)
            .put("plan", JSONObject().put("content", planJson(record.plan.plan)))
            .toString()).apply()
    }

    private fun planJson(plan: AgentPlan): JSONObject = JSONObject()
        .put("summary", plan.summary)
        .put("domain", plan.domain)
        .put("agent", plan.agent)
        .put("subAgent", plan.subAgent)
        .put("preSubAgent", plan.preSubAgent)
        .put("skill", plan.skill)
        .put("expectedResult", plan.expectedResult)
        .put("actions", JSONArray().apply {
            plan.actions.actions.forEach { action ->
                put(JSONObject()
                    .put("action", action.type.name)
                    .put("recommendationType", "RECOMMENDATION")
                    .put("recommendation", action.recommendation)
                    .put("agent", action.agent)
                    .put("subAgent", action.subAgent)
                    .put("skill", action.skill)
                    .putNullable("target", action.target)
                    .putNullable("text", action.text)
                    .put("timeoutMs", action.timeoutMs)
                    .put("requiresApproval", action.requiresApproval)
                    .putNullable("approvalReason", action.approvalReason))
            }
        })

    private fun JSONObject.putNullable(name: String, value: String?): JSONObject =
        if (value == null) put(name, JSONObject.NULL) else put(name, value)

    private fun key(task: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(task.trim().lowercase().toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return "workflow.$digest"
    }

    private data class Record(
        val plan: AgentPlanResult,
        val appContext: String,
        val version: Int,
        val successCount: Int,
        val failureCount: Int,
        val confidence: Double,
        val enabled: Boolean,
        val lastValidated: Long,
    )

    private companion object {
        const val MIN_CONFIDENCE = 0.8
    }
}
