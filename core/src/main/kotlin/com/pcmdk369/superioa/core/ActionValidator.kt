package com.pcmdk369.superioa.core

object ActionValidator {
    private const val MAX_ACTIONS = 50
    private const val MAX_TARGET_LENGTH = 200
    private const val MAX_TEXT_LENGTH = 2_000
    private const val DEFAULT_TIMEOUT_MS = 5_000
    private const val MAX_TIMEOUT_MS = 30_000

    private val targetRequired = setOf(
        ActionType.OPEN_APP,
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

            val timeout = candidate.timeoutMs ?: DEFAULT_TIMEOUT_MS
            if (timeout !in 1..MAX_TIMEOUT_MS) {
                return PlanValidation.Invalid("Action ${index + 1} has a timeout outside the allowed range.")
            }
            validated += ValidatedAction(type, candidate.target, candidate.text, timeout)
        }

        return PlanValidation.Valid(ActionPlan(validated))
    }
}