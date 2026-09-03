import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.mockwebserver.*
import java.util.concurrent.TimeUnit
import kotlin.test.*

class MainTest {
    private val delta = """{"type":"response.output_text.delta","delta":"Привет"}"""
    private val done = """{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":3}}}"""
    private fun sse(vararg items: String) = items.joinToString("") { "data: $it\n\n" }

    @Test fun sameQuestionDifferentControls() {
        val a = payload("Вопрос", MODELS[0], false)
        val b = payload("Вопрос", MODELS[0], true)
        assertEquals(setOf("instructions", "max_output_tokens"), a.keys.filter { a[it] != b[it] }.toSet())
        assertEquals(JsonPrimitive(false), a["store"])
        assertEquals(JsonPrimitive(true), a["stream"])
        assertFalse("stop" in b)
        assertTrue(b.getValue("instructions").jsonPrimitive.content.contains(Controls().instructions()))
    }

    @Test fun controlsOnlyChangeRightRequest() {
        val controls = Controls(FORMATS[1], 5, 120, 1024, "ГОТОВО")
        val right = payload("Вопрос", MODELS[0], true, controls)
        assertEquals(JsonPrimitive(1024), right["max_output_tokens"])
        assertTrue(right.getValue("instructions").jsonPrimitive.content.contains(controls.instructions()))
        assertTrue(controls.instructions().contains("5 пунктами"))
        assertTrue(controls.instructions().contains("120 слов"))
        assertTrue(controls.instructions().contains("ГОТОВО"))
        assertEquals(payload("Вопрос", MODELS[0], false), payload("Вопрос", MODELS[0], false, controls))
        MODELS.forEach { assertEquals(JsonPrimitive(it), payload("Вопрос", it, true)["model"]) }
        assertFailsWith<IllegalArgumentException> { payload("Вопрос", "рол", true) }
    }

    @Test fun validateControlsAndBoundaries() {
        Controls(count = 1, maxWords = 20, maxTokens = 128)
        Controls(count = 8, maxWords = 300, maxTokens = 2048)
        assertFailsWith<IllegalArgumentException> { Controls(count = 0) }
        assertFailsWith<IllegalArgumentException> { Controls(maxWords = 301) }
        assertFailsWith<IllegalArgumentException> { Controls(maxTokens = 0) }
        assertFailsWith<IllegalArgumentException> { Controls(format = "unknown") }
        assertFailsWith<IllegalArgumentException> { Controls(ending = "") }
    }

    @Test fun checksFollowSelectedFormatAndEnding() {
        val bullets = Controls(FORMATS[1], 2, 20, 128, "ГОТОВО")
        assertFalse(checks("- Один\n- Два\nГОТОВО", bullets).contains("✗"))
        assertTrue(checks("- Один\nГОТОВО", bullets).contains("Формат: ✗"))
        assertTrue(checks("- Один\n- Два\nКОНЕЦ", bullets).contains("ГОТОВО: ✗"))
        val paragraph = Controls(format = FORMATS[2], ending = "END")
        assertFalse(checks("Простой абзац.\nEND", paragraph).contains("✗"))
        assertTrue(checks("- Не абзац\nEND", paragraph).contains("Формат: ✗"))
        assertTrue(checks("Первый\nВторой\nEND", paragraph).contains("Формат: ✗"))
        assertFalse(paragraph.instructions().contains("пунктами"))
        assertTrue(checks("END\nEND", paragraph).contains("END: ✗"))
    }

    @Test fun previousSettingsRemainImmutable() {
        val used = Controls()
        val next = used.copy(maxWords = 20, ending = "END")
        val text = "1. Один\n2. Два\n3. Три\nКОНЕЦ"
        assertFalse(checks(text, used).contains("✗"))
        assertTrue(checks(text, next).contains("END: ✗"))
    }

    @Test fun textAppearsBeforeCompletion() {
        val partial = accept(Answer(), delta)
        assertEquals("Привет", partial.text)
        assertFalse(partial.terminal)
        val finished = accept(partial, done)
        assertTrue(finished.terminal)
        assertEquals("Привет", finished.text)
        assertEquals("10 вход / 3 выход", finished.tokens)
    }

    @Test fun incompleteAndRefusalAreNotHidden() {
        val refusal = accept(Answer(), """{"type":"response.refusal.delta","delta":"Не могу"}""")
        assertTrue(accept(refusal, done).status.contains("отказ"))
        val limited = accept(Answer(), """{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}""")
        assertTrue(limited.status.contains("max_output_tokens"))
        assertTrue(limited.terminal)
        assertTrue(accept(Answer(), """{"type":"response.failed","response":{"status":"failed"}}""").terminal)
        assertTrue(accept(Answer(), """{"type":"error"}""").terminal)
    }

    @Test fun checksDoNotRewriteTheAnswer() {
        val text = "1. Один\n2. Два\n3. Три\nКОНЕЦ"
        assertEquals(4, words(text))
        assertFalse(checks(text).contains("✗"))
        assertTrue(checks("$text\nЛишнее").contains("КОНЕЦ: ✗"))
        assertTrue(checks(text.replace("2.", "4.")).contains("Формат: ✗"))
        assertTrue(checks("слово ".repeat(91)).contains("≤90 слов: ✗"))
        assertTrue(checks("").contains("КОНЕЦ: ✗"))
    }

    @Test fun twoRealSseConnectionsStreamIndependently() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody(sse(delta, done)).throttleBody(sse(delta).toByteArray().size.toLong(), 200, TimeUnit.MILLISECONDS)) }
            val streams = List(2) { async {
                val states = mutableListOf<Answer>()
                var answer = Answer()
                withTimeout(5_000) { events(Request.Builder().url(server.url("/responses")).build()).collect {
                    answer = accept(answer, it); states += answer
                } }
                assertEquals("Привет", states.first().text)
                assertFalse(states.first().terminal)
                assertTrue(states.last().terminal)
            } }
            streams.awaitAll()
            assertEquals(2, server.requestCount)
        }
    }

    @Test fun eofWithoutTerminalEventIsNotSuccess() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(sse(delta)))
            var answer = Answer()
            withTimeout(5_000) { events(Request.Builder().url(server.url("/")).build()).collect { answer = accept(answer, it) } }
            assertEquals("Привет", answer.text)
            assertFalse(answer.terminal)
        }
    }

    @Test fun httpErrorDoesNotLeakResponseBody() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401).setBody("sensitive-test-value"))
            val error = assertFailsWith<IllegalStateException> {
                withTimeout(5_000) { events(Request.Builder().url(server.url("/")).build()).toList() }
            }
            assertTrue(error.message!!.contains("401"))
            assertFalse(error.message!!.contains("sensitive-test-value"))
        }
    }

    @Test fun cancellationClosesConnection() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(sse(delta, done))
                .throttleBody(sse(delta).toByteArray().size.toLong(), 200, TimeUnit.MILLISECONDS))
            val http = client.newBuilder().build()
            withTimeout(5_000) { events(Request.Builder().url(server.url("/")).build(), http).first() }
            withTimeout(5_000) { while (http.dispatcher.runningCallsCount() != 0) delay(10) }
            assertEquals(0, http.dispatcher.runningCallsCount())
        }
    }
}
