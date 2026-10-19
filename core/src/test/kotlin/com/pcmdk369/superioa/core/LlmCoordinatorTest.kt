package com.pcmdk369.superioa.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class LlmCoordinatorTest {
    private val first = EngineConfig("engine-1", true, "secret-one", "https://one.example", "model-one")
    private val second = EngineConfig("engine-2", true, "secret-two", "https://two.example", "model-two")

    @Test
    fun fallsBackSequentiallyAfterBoundedRetry() {
        val calls = mutableListOf<String>()
        val coordinator = LlmCoordinator(listOf(first, second), LlmEngineClient { config, _ ->
            calls += config.id
            if (config == first) throw EngineFailure(EngineFailureKind.RETRYABLE, "temporary outage")
            "structured plan"
        })

        val result = assertIs<LlmResult.Success>(coordinator.generate("open the browser"))
        assertEquals(listOf("engine-1", "engine-1", "engine-2"), calls)
        assertEquals("engine-2", result.engineId)
        assertEquals(2, result.attempts.size)
    }

    @Test
    fun doesNotFailOverAfterCancellationOrSecurityDenial() {
        val calls = mutableListOf<String>()
        val coordinator = LlmCoordinator(listOf(first, second), LlmEngineClient { config, _ ->
            calls += config.id
            throw EngineFailure(EngineFailureKind.SECURITY_DENIED, "approval required")
        })

        assertIs<LlmResult.Failure>(coordinator.generate("send a message"))
        assertEquals(listOf("engine-1"), calls)
    }

    @Test
    fun redactsCredentialValuesFromProviderErrors() {
        val coordinator = LlmCoordinator(listOf(first, second), LlmEngineClient { _, _ ->
            throw EngineFailure(EngineFailureKind.CONFIGURATION, "api_key=leaked secret-one")
        })

        val result = assertIs<LlmResult.Failure>(coordinator.generate("plan"))
        assertEquals("api_key=[REDACTED] [REDACTED]", result.attempts.first().reason)
    }

    @Test
    fun skipsDisabledAndInvalidEngines() {
        val calls = mutableListOf<String>()
        val invalid = second.copy(baseUrl = "http://insecure.example")
        val disabled = second.copy(id = "disabled", enabled = false)
        val coordinator = LlmCoordinator(listOf(disabled, invalid), LlmEngineClient { config, _ ->
            calls += config.id
            "unexpected"
        })

        val result = assertIs<LlmResult.Failure>(coordinator.generate("plan"))
        assertEquals(emptyList(), calls)
        assertEquals(1, result.attempts.size)
    }

    @Test
    fun usesIndependentRetryLimitsAndRejectsInvalidRetryConfiguration() {
        val calls = mutableListOf<String>()
        val customizedFirst = first.copy(maxRetries = 0)
        val coordinator = LlmCoordinator(listOf(customizedFirst, second), LlmEngineClient { config, _ ->
            calls += config.id
            if (config == customizedFirst) throw EngineFailure(EngineFailureKind.RETRYABLE, "temporary outage")
            "structured plan"
        })

        val result = assertIs<LlmResult.Success>(coordinator.generate("open the browser"))
        assertEquals(listOf("engine-1", "engine-2"), calls)
        assertEquals("engine-2", result.engineId)
        assertEquals(false, first.copy(maxRetries = 3).isUsable())
    }
}