package com.pcmdk369.superioa.core

enum class ActionType {
    OPEN_APP,
    BACK,
    HOME,
    RECENTS,
    TAP,
    TYPE,
    SCROLL,
    SWIPE,
    COPY,
    PASTE,
    READ_UI,
    WAIT,
    VERIFY,
    RETRY,
    ABORT,
    REQUEST_USER,
}

data class ProposedAction(
    val action: String,
    val target: String? = null,
    val text: String? = null,
    val timeoutMs: Int? = null,
    val requiresApproval: Boolean = false,
    val approvalReason: String? = null,
)

data class ValidatedAction(
    val type: ActionType,
    val target: String?,
    val text: String?,
    val timeoutMs: Int,
    val requiresApproval: Boolean = false,
    val approvalReason: String? = null,
)

data class ActionPlan(val actions: List<ValidatedAction>)

data class AgentPlan(
    val summary: String,
    val domain: String,
    val subAgent: String,
    val preSubAgent: String?,
    val skill: String,
    val expectedResult: String,
    val actions: ActionPlan,
)

sealed interface PlanValidation {
    data class Valid(val plan: ActionPlan) : PlanValidation
    data class Invalid(val reason: String) : PlanValidation
}