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
)

data class ValidatedAction(
    val type: ActionType,
    val target: String?,
    val text: String?,
    val timeoutMs: Int,
)

data class ActionPlan(val actions: List<ValidatedAction>)

sealed interface PlanValidation {
    data class Valid(val plan: ActionPlan) : PlanValidation
    data class Invalid(val reason: String) : PlanValidation
}