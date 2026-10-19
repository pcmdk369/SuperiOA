package com.pcmdk369.superioa.core

data class EngineConfig(
    val id: String,
    val enabled: Boolean,
    val apiKey: String,
    val baseUrl: String,
    val modelId: String,
    val timeoutMs: Int = 20_000,
    val maxRetries: Int = 1,
    val retryDelayMs: Long = 250,
) {
    fun isUsable(): Boolean = enabled && id.isNotBlank() && apiKey.isNotBlank() &&
        baseUrl.startsWith("https://") && modelId.isNotBlank() && timeoutMs in 1..60_000 &&
        maxRetries in 0..2 && retryDelayMs in 0..5_000
}

enum class EngineFailureKind { RETRYABLE, CONFIGURATION, CANCELLED, SECURITY_DENIED }

class EngineFailure(
    val kind: EngineFailureKind,
    message: String,
) : RuntimeException(message)

fun interface LlmEngineClient {
    /** The provider adapter must enforce the configured timeout and provider-specific request format. */
    fun generate(config: EngineConfig, prompt: String): String
}

data class EngineAttempt(
    val engineId: String,
    val attempt: Int,
    val reason: String,
)

sealed interface LlmResult {
    data class Success(
        val engineId: String,
        val response: String,
        val attempts: List<EngineAttempt>,
    ) : LlmResult

    data class Failure(val attempts: List<EngineAttempt>) : LlmResult
}

class LlmCoordinator(
    private val engines: List<EngineConfig>,
    private val client: LlmEngineClient,
) {
    fun generate(prompt: String): LlmResult {
        if (prompt.isBlank()) return LlmResult.Failure(emptyList())
        val attempts = mutableListOf<EngineAttempt>()

        for (engine in engines) {
            if (!engine.enabled) continue
            if (!engine.isUsable()) {
                attempts += EngineAttempt(engine.id, 0, "Engine configuration is incomplete or invalid.")
                continue
            }

            for (attempt in 1..(engine.maxRetries + 1)) {
                try {
                    val response = client.generate(engine, prompt)
                    if (response.isBlank()) {
                        attempts += EngineAttempt(engine.id, attempt, "Provider returned an empty response.")
                        break
                    }
                    return LlmResult.Success(engine.id, response, attempts.toList())
                } catch (failure: EngineFailure) {
                    if (failure.kind == EngineFailureKind.CANCELLED ||
                        failure.kind == EngineFailureKind.SECURITY_DENIED
                    ) {
                        return LlmResult.Failure(
                            attempts + EngineAttempt(engine.id, attempt, SecretRedactor.redact(failure.message.orEmpty(), engines)),
                        )
                    }

                    attempts += EngineAttempt(engine.id, attempt, SecretRedactor.redact(failure.message.orEmpty(), engines))
                    if (failure.kind != EngineFailureKind.RETRYABLE || attempt == engine.maxRetries + 1) break
                    try {
                        Thread.sleep(engine.retryDelayMs)
                    } catch (interrupted: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return LlmResult.Failure(attempts + EngineAttempt(engine.id, attempt, "Request cancelled."))
                    }
                } catch (failure: Exception) {
                    attempts += EngineAttempt(engine.id, attempt, SecretRedactor.redact(failure.message.orEmpty(), engines))
                    break
                }
            }
        }

        return LlmResult.Failure(attempts)
    }
}

object SecretRedactor {
    private val credentialPattern = Regex("(?i)(api[_-]?key|authorization|bearer)(\\s*[:=]\\s*|\\s+)[^\\s,;]+")

    fun redact(message: String, engines: List<EngineConfig>): String {
        var safe = credentialPattern.replace(message) { "${it.groupValues[1]}=[REDACTED]" }
        engines.map(EngineConfig::apiKey).filter(String::isNotBlank).forEach { secret ->
            safe = safe.replace(secret, "[REDACTED]")
        }
        return safe.take(300)
    }
}