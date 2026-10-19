package com.pcmdk369.superioa.core

import java.net.URI

object ActionValidator {
    private const val MAX_ACTIONS = 50
    private const val MAX_TARGET_LENGTH = 200
    private const val MAX_TEXT_LENGTH = 2_000
    private const val MAX_RECOMMENDATION_LENGTH = 300
    private const val MAX_ROUTE_LABEL_LENGTH = 120
    private const val DEFAULT_TIMEOUT_MS = 5_000
    private const val MAX_TIMEOUT_MS = 30_000

    private val targetRequired = setOf(
        ActionType.OPEN_APP,
        ActionType.OPEN_URL,
        ActionType.TAP,
        ActionType.TYPE,
        ActionType.SCROLL,
        ActionType.SWIPE,
        ActionType.VERIFY,
    )
    private val textRequired = setOf(ActionType.TYPE, ActionType.REQUEST_USER)

    fun validate(proposed: List<ProposedAction>): PlanValidation {
        if (proposed.isEmpty()) return PlanValidation.Invalid("A plan must contain at least one action.")
        if (proposed.size > MAX_ACTIONS) {
            return PlanValidation.Invalid("A plan cannot contain more than $MAX_ACTIONS actions.")
        }

        val validated = mutableListOf<ValidatedAction>()
        for ((index, candidate) in proposed.withIndex()) {
            val type = ActionType.entries.firstOrNull { it.name == candidate.action }
                ?: return PlanValidation.Invalid("Action ${index + 1} has an unsupported action type.")

            if (type in targetRequired && candidate.target.isNullOrBlank()) {
                return PlanValidation.Invalid("Action ${index + 1} requires a target.")
            }
            if (candidate.target != null && candidate.target.length > MAX_TARGET_LENGTH) {
                return PlanValidation.Invalid("Action ${index + 1} has a target that is too long.")
            }
            if (type == ActionType.OPEN_URL && !isSafeWebUrl(candidate.target.orEmpty())) {
                return PlanValidation.Invalid("Action ${index + 1} requires a valid HTTPS URL without embedded credentials.")
            }
            if (type in textRequired && candidate.text.isNullOrBlank()) {
                return PlanValidation.Invalid("Action ${index + 1} requires text.")
            }
            if (candidate.text != null && candidate.text.length > MAX_TEXT_LENGTH) {
                return PlanValidation.Invalid("Action ${index + 1} has text that is too long.")
            }
            if (type !in textRequired && candidate.text != null) {
                return PlanValidation.Invalid("Action ${index + 1} does not accept text.")
            }
            if (type !in targetRequired && candidate.target != null) {
                return PlanValidation.Invalid("Action ${index + 1} does not accept a target.")
            }
            if (candidate.requiresApproval && candidate.approvalReason.isNullOrBlank()) {
                return PlanValidation.Invalid("Action ${index + 1} requires an approval reason.")
            }
            if (!candidate.requiresApproval && candidate.approvalReason != null) {
                return PlanValidation.Invalid("Action ${index + 1} has an unexpected approval reason.")
            }
            if (candidate.approvalReason != null && candidate.approvalReason.length > MAX_TARGET_LENGTH) {
                return PlanValidation.Invalid("Action ${index + 1} has an approval reason that is too long.")
            }
            if (candidate.recommendationType != "RECOMMENDATION") {
                return PlanValidation.Invalid("Action ${index + 1} must be a recommendation.")
            }
            val recommendation = candidate.recommendation?.takeIf {
                it.isNotBlank() && it.length <= MAX_RECOMMENDATION_LENGTH
            } ?: run {
                return PlanValidation.Invalid("Action ${index + 1} requires a concise recommendation.")
            }
            val routeLabels = listOf(candidate.agent, candidate.subAgent, candidate.skill)
            if (routeLabels.any { it.isNullOrBlank() || it.length > MAX_ROUTE_LABEL_LENGTH }) {
                return PlanValidation.Invalid("Action ${index + 1} requires agent, sub-agent, and skill attribution.")
            }
            val agent = candidate.agent.orEmpty()
            val subAgent = candidate.subAgent.orEmpty()
            val skill = candidate.skill.orEmpty()

            val timeout = candidate.timeoutMs ?: DEFAULT_TIMEOUT_MS
            if (timeout !in 1..MAX_TIMEOUT_MS) {
                return PlanValidation.Invalid("Action ${index + 1} has a timeout outside the allowed range.")
            }
            validated += ValidatedAction(
                type,
                candidate.target,
                candidate.text,
                timeout,
                candidate.requiresApproval,
                candidate.approvalReason,
                recommendation,
                agent,
                subAgent,
                skill,
            )
        }

        return PlanValidation.Valid(ActionPlan(validated))
    }

    private fun isSafeWebUrl(value: String): Boolean = runCatching {
        URI(value).let { uri ->
            uri.scheme.equals("https", ignoreCase = true) &&
                !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null
        }
    }.getOrDefault(false)
}

object SafetyGate {
    private val sensitiveAction = Regex(
        """\b(send|publish|post|delete|remove|purchase|buy|checkout|pay|payment|transfer|password|passcode|otp|captcha|biometric|security|confirm)\b""",
        RegexOption.IGNORE_CASE,
    )

    fun approvalReason(action: ValidatedAction): String? {
        if (action.requiresApproval) return action.approvalReason ?: "This action was marked as sensitive."
        if (action.type == ActionType.REQUEST_USER) return "The task requires your input."
        val context = listOfNotNull(action.target, action.text).joinToString(" ")
        return if (sensitiveAction.containsMatchIn(context)) {
            "This action may affect a sensitive or external operation."
        } else {
            null
        }
    }
}