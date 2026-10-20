package com.pcmdk369.superioa.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ActionValidatorTest {
    @Test
    fun acceptsValidPlanAndAppliesDefaultTimeout() {
        val result = ActionValidator.validate(
            listOf(recommended(action = "OPEN_APP", target = "Chrome")),
        )

        val plan = assertIs<PlanValidation.Valid>(result).plan
        assertEquals(ActionType.OPEN_APP, plan.actions.single().type)
        assertEquals(5_000, plan.actions.single().timeoutMs)
    }

    @Test
    fun acceptsHttpsUrlAndRejectsUnsafeOrMalformedUrls() {
        val accepted = ActionValidator.validate(
            listOf(recommended(action = "OPEN_URL", target = "https://example.com/search?q=android")),
        )
        assertEquals(
            ActionType.OPEN_URL,
            assertIs<PlanValidation.Valid>(accepted).plan.actions.single().type,
        )

        for (url in listOf("http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "https:///missing-host")) {
            assertIs<PlanValidation.Invalid>(
                ActionValidator.validate(listOf(recommended(action = "OPEN_URL", target = url))),
            )
        }
    }

    @Test
    fun rejectsUnknownActionAndMissingRequiredFields() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(recommended(action = "RUN_SHELL"))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(recommended(action = "TAP"))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(recommended(action = "TYPE", target = "Search"))),
        )
    }

    @Test
    fun rejectsOutOfRangeTimeoutAndUnexpectedFields() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(recommended(action = "WAIT", timeoutMs = 30_001))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(recommended(action = "BACK", text = "unexpected"))),
        )
    }

    @Test
    fun rejectsPlansOutsideActionCountBounds() {
        assertIs<PlanValidation.Invalid>(ActionValidator.validate(emptyList()))
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(List(51) { recommended(action = "BACK") }),
        )
    }

    @Test
    fun requiresAReasonForExplicitApprovalAndRejectsOrphanReasons() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(
                listOf(recommended(action = "TAP", target = "Send", requiresApproval = true)),
            ),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(
                listOf(recommended(action = "BACK", approvalReason = "Sensitive action")),
            ),
        )
        assertIs<PlanValidation.Valid>(
            ActionValidator.validate(
                listOf(
                    recommended(
                        action = "TAP",
                        target = "Send",
                        requiresApproval = true,
                        approvalReason = "Send a message",
                    ),
                ),
            ),
        )
    }

    @Test
    fun requiresEveryActionToHaveRecommendationAndAgentSkillAttribution() {
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(listOf(ProposedAction(action = "BACK"))),
        )
        assertIs<PlanValidation.Invalid>(
            ActionValidator.validate(
                listOf(recommended(action = "BACK").copy(recommendationType = "EXECUTE")),
            ),
        )
        assertIs<PlanValidation.Valid>(
            ActionValidator.validate(listOf(recommended(action = "BACK"))),
        )
    }

    @Test
    fun detectsSensitiveActionsIndependentlyOfThePlannerFlag() {
        val action = recommendedValidated(ActionType.TAP, "Pay now")
        assertEquals(
            "Confirm this screen action before it runs.",
            SafetyGate.approvalReason(action),
        )
        assertEquals(
            "Confirm this screen action before it runs.",
            SafetyGate.approvalReason(recommendedValidated(ActionType.TAP, "Place order")),
        )
        assertEquals(
            "Confirm this screen action before it runs.",
            SafetyGate.approvalReason(recommendedValidated(ActionType.TAP, "Continue")),
        )
        assertEquals(
            null,
            SafetyGate.approvalReason(recommendedValidated(ActionType.BACK)),
        )
    }

    private fun recommended(
        action: String,
        target: String? = null,
        text: String? = null,
        timeoutMs: Int? = null,
        requiresApproval: Boolean = false,
        approvalReason: String? = null,
    ) = ProposedAction(
        action = action,
        target = target,
        text = text,
        timeoutMs = timeoutMs,
        requiresApproval = requiresApproval,
        approvalReason = approvalReason,
        recommendationType = "RECOMMENDATION",
        recommendation = "Recommended next step for the task.",
        agent = "SuperiOA Coordinator",
        subAgent = "Device",
        skill = "Navigation",
    )

    private fun recommendedValidated(
        type: ActionType,
        target: String? = null,
    ) = ValidatedAction(
        type = type,
        target = target,
        text = null,
        timeoutMs = 5_000,
        recommendation = "Recommended next step for the task.",
        agent = "SuperiOA Coordinator",
        subAgent = "Device",
        skill = "Navigation",
    )
}