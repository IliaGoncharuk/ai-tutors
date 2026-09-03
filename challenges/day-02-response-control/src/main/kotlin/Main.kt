import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.Button
import androidx.compose.material.Card
import androidx.compose.material.Divider
import androidx.compose.material.DropdownMenu
import androidx.compose.material.DropdownMenuItem
import androidx.compose.material.MaterialTheme
import androidx.compose.material.OutlinedButton
import androidx.compose.material.OutlinedTextField
import androidx.compose.material.Slider
import androidx.compose.material.Surface
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

val MODELS = listOf("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol")
val FORMATS = listOf("Нумерованный список", "Список с тире", "Один абзац")
val ENDINGS = listOf("КОНЕЦ", "ГОТОВО", "END")

data class Controls(
    val format: String = FORMATS[0],
    val count: Int = 3,
    val maxWords: Int = 90,
    val maxTokens: Int = 512,
    val ending: String = ENDINGS[0],
) {
    init {
        require(format in FORMATS && count in 1..8 && maxWords in 20..300)
        require(maxTokens in 128..2048 && ending in ENDINGS)
    }
    // Крутилки задают инструкцию; API-лимит токенов передаём отдельно.
    fun instructions(): String {
        val formatInstruction = when (format) {
            FORMATS[0] -> "Ответь ровно $count пунктами, нумерация от 1 до $count с точкой, каждый с новой строки. "
            FORMATS[1] -> "Ответь ровно $count пунктами, каждый с новой строки и начинается с '- '. "
            else -> "Ответь одним абзацем на одной строке, без списка. "
        }
        return formatInstruction +
            "Без заголовка и вступления. Не более $maxWords слов во всём ответе, включая маркер. " +
            "Затем напиши отдельной строкой $ending и заверши ответ: после неё ничего не пиши."
    }
}

const val API = "https://api.openai.com/v1/responses"
val client = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .retryOnConnectionFailure(false)
    .build()

// Меняются только инструкции и бюджет ответа; вопрос и модель одинаковы.
fun payload(
    prompt: String,
    model: String,
    controlled: Boolean,
    controls: Controls = Controls(),
) = buildJsonObject {
    require(model in MODELS)
    put("model", model)
    put("input", prompt)
    put("stream", true)
    put("store", false)
    put("instructions", "Отвечай на русском языке." + if (controlled) " ${controls.instructions()}" else "")
    put("max_output_tokens", if (controlled) controls.maxTokens else 2048)
    putJsonObject("reasoning") { put("effort", "none") }
}

// SSE-библиотека собирает сетевые фрагменты в события; Flow доставляет их интерфейсу.
fun events(request: Request, http: OkHttpClient = client): Flow<String> = callbackFlow {
    val source = EventSources.createFactory(http).newEventSource(request, object : EventSourceListener() {
        override fun onEvent(source: EventSource, id: String?, type: String?, data: String) {
            try {
                val kind = Json.parseToJsonElement(data).jsonObject["type"]?.jsonPrimitive?.content
                // Не теряем фрагменты молча, даже если получатель не успевает их обработать.
                if (trySend(data).isFailure) close(IllegalStateException("Поток переполнен"))
                if (kind in setOf("response.completed", "response.incomplete", "response.failed", "error")) close()
            } catch (_: Exception) {
                close(IllegalStateException("Некорректное событие API"))
            }
        }
        override fun onFailure(source: EventSource, t: Throwable?, response: Response?) {
            // Не выводим тело ошибки или исключение: они могут содержать чувствительные данные.
            val message = response?.let {
                "HTTP ${it.code}: проверьте ключ, модель и лимиты API"
            } ?: "Соединение прервано или истёк тайм-аут"
            close(IllegalStateException(message))
        }

        override fun onClosed(source: EventSource) {
            close()
        }
    })
    awaitClose { source.cancel() } // Отмена генерации/закрытие окна освобождает соединение.
}.buffer(1024)

data class Answer(
    val text: String = "",
    val status: String = "Ожидание",
    val tokens: String = "—",
    val terminal: Boolean = false,
    val refused: Boolean = false,
)

// Чистая функция: её можно проверить без окна, сети и платных API-запросов.
fun accept(answer: Answer, data: String): Answer {
    val event = Json.parseToJsonElement(data).jsonObject
    return when (event["type"]?.jsonPrimitive?.content) {
        "response.output_text.delta", "response.refusal.delta" -> {
            val isRefusal = event["type"]?.jsonPrimitive?.content == "response.refusal.delta"
            answer.copy(
                text = answer.text + event.getValue("delta").jsonPrimitive.content,
                refused = answer.refused || isRefusal,
            )
        }
        "response.completed", "response.incomplete", "response.failed" -> {
            val response = event.getValue("response").jsonObject
            val usage = response["usage"] as? JsonObject
            val reason = (response["incomplete_details"] as? JsonObject)?.get("reason")?.jsonPrimitive?.content
            val status = response.getValue("status").jsonPrimitive.content
            answer.copy(
                terminal = true,
                status = status + (reason?.let { " ($it)" } ?: "") +
                    if (answer.refused) " · отказ модели" else "",
                tokens = "${usage?.get("input_tokens") ?: "—"} вход / " +
                    "${usage?.get("output_tokens") ?: "—"} выход",
            )
        }
        "error" -> answer.copy(status = "Ошибка потока API", terminal = true)
        else -> answer
    }
}

// Слова здесь — группы букв/цифр; номера пунктов не считаются, маркер КОНЕЦ считается.
fun words(text: String) = Regex("[\\p{L}\\p{N}]+(?:[-’'][\\p{L}\\p{N}]+)*")
    .findAll(text.replace(Regex("(?m)^\\s*\\d+\\.\\s+"), "")).count()
fun checks(text: String, controls: Controls = Controls()): String {
    val lines = text.trim().lines().filter { it.isNotBlank() }
    val body = if (lines.lastOrNull() == controls.ending) lines.dropLast(1) else lines
    val format = when (controls.format) {
        FORMATS[0] -> body.size == controls.count && body.indices.all {
            body[it].matches(Regex("${it + 1}\\.\\s+\\S.*"))
        }
        FORMATS[1] -> body.size == controls.count && body.all { it.matches(Regex("-\\s+\\S.*")) }
        else -> body.size == 1 && !body[0].matches(Regex("(?:\\d+\\.|[-*•])\\s+.*"))
    }
    val end = lines.lastOrNull() == controls.ending && lines.count { it == controls.ending } == 1
    val formatMark = if (format) "✓" else "✗"
    val lengthMark = if (words(text) <= controls.maxWords) "✓" else "✗"
    val endingMark = if (end) "✓" else "✗"
    return "Формат: $formatMark · ≤${controls.maxWords} слов: $lengthMark · ${controls.ending}: $endingMark"
}

fun request(prompt: String, model: String, controlled: Boolean, controls: Controls, key: String): Request =
    Request.Builder()
        .url(API)
        .header("Authorization", "Bearer $key")
        .post(
            payload(prompt, model, controlled, controls)
                .toString()
                .toRequestBody("application/json".toMediaType()),
        )
        .build()

suspend fun streamAnswer(request: Request, onUpdate: (Answer) -> Unit) {
    var answer = Answer(status = "Генерация…")
    onUpdate(answer)
    try {
        withTimeout(180_000) {
            events(request).collect { event ->
                answer = accept(answer, event)
                onUpdate(answer)
            }
        }
        if (!answer.terminal) {
            onUpdate(answer.copy(status = "Поток оборван до завершения"))
        }
    } catch (_: TimeoutCancellationException) {
        onUpdate(answer.copy(status = "Превышено время ожидания: 3 минуты"))
    } catch (exception: CancellationException) {
        throw exception
    } catch (_: Exception) {
        onUpdate(answer.copy(status = "Ошибка API/сети. Проверьте ключ, модель, баланс и соединение."))
    }
}

suspend fun compareAnswers(
    prompt: String,
    model: String,
    controls: Controls,
    key: String,
    onUpdate: (index: Int, answer: Answer) -> Unit,
) = supervisorScope {
    // Supervisor сохраняет второй поток, если запрос в соседней колонке завершился ошибкой.
    repeat(2) { index ->
        launch {
            val request = request(prompt, model, controlled = index == 1, controls, key)
            streamAnswer(request) { answer -> onUpdate(index, answer) }
        }
    }
}

// Общие маленькие элементы управления вместо редактирования промпта руками.
@Composable
fun Choice(
    label: String,
    value: String,
    options: List<String>,
    enabled: Boolean,
    onChange: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.caption)
        Box {
            OutlinedButton(onClick = { expanded = true }, enabled = enabled) {
                Text("$value ▾")
            }
            DropdownMenu(expanded && enabled, { expanded = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        onClick = {
                            onChange(option)
                            expanded = false
                        },
                    ) {
                        Text(option)
                    }
                }
            }
        }
    }
}

@Composable
fun Dial(
    label: String,
    value: Int,
    range: IntRange,
    step: Int,
    enabled: Boolean,
    onChange: (Int) -> Unit,
) {
    Text("$label: $value", style = MaterialTheme.typography.caption)
    Slider(
        value = value.toFloat(),
        onValueChange = { rawValue ->
            val steppedValue = range.first + ((rawValue - range.first) / step).roundToInt() * step
            onChange(steppedValue.coerceIn(range))
        },
        enabled = enabled,
        valueRange = range.first.toFloat()..range.last.toFloat(),
        steps = (range.last - range.first) / step - 1,
    )
}

@Composable
fun ControlledAnswerSettings(controls: Controls, enabled: Boolean, onChange: (Controls) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Choice("Формат", controls.format, FORMATS, enabled) {
            onChange(controls.copy(format = it))
        }
        Choice("Завершение", controls.ending, ENDINGS, enabled) {
            onChange(controls.copy(ending = it))
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f)) {
            val countEnabled = enabled && controls.format != FORMATS[2]
            Dial("Пунктов", controls.count, 1..8, 1, countEnabled) {
                onChange(controls.copy(count = it))
            }
        }
        Column(Modifier.weight(1f)) {
            Dial("Максимум слов", controls.maxWords, 20..300, 10, enabled) {
                onChange(controls.copy(maxWords = it))
            }
        }
    }
    Dial("Потолок токенов", controls.maxTokens, 128..2048, 128, enabled) {
        onChange(controls.copy(maxTokens = it))
    }
}

@Composable
fun RowScope.AnswerCard(
    index: Int,
    answer: Answer,
    controls: Controls,
    usedControls: Controls,
    running: Boolean,
    onControlsChange: (Controls) -> Unit,
) {
    Card(Modifier.weight(1f).fillMaxHeight(), elevation = 3.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val controlled = index == 1
            Text(
                if (controlled) "С ограничениями" else "Без ограничений задания",
                style = MaterialTheme.typography.h6,
            )
            if (controlled) {
                ControlledAnswerSettings(controls, !running, onControlsChange)
            } else {
                Text("Технический потолок: 2048 токена", style = MaterialTheme.typography.caption)
            }

            val scroll = rememberScrollState()
            LaunchedEffect(answer.text) { scroll.scrollTo(scroll.maxValue) }
            SelectionContainer(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll)) {
                Text(answer.text.ifEmpty { "Здесь появится ответ…" })
            }

            Divider()
            Text(answer.status, style = MaterialTheme.typography.caption)
            Text(
                "Слов: ${words(answer.text)} · Токены: ${answer.tokens}",
                style = MaterialTheme.typography.caption,
            )
            if (controlled && answer.terminal) {
                Text(checks(answer.text, usedControls), style = MaterialTheme.typography.caption)
                if (controls != usedControls) {
                    Text(
                        "Настройки изменены — применятся при следующем запуске.",
                        style = MaterialTheme.typography.caption,
                    )
                }
            }
        }
    }
}

@Composable
fun App() {
    var prompt by remember { mutableStateOf("Объясни, как работает HTTP-запрос, на понятном примере.") }
    var model by remember { mutableStateOf(MODELS[0]) }
    var controls by remember { mutableStateOf(Controls()) }
    var usedControls by remember { mutableStateOf(controls) }
    val key = remember { System.getenv("OPENAI_API_KEY")?.takeIf { it.isNotBlank() } }
    val answers = remember { mutableStateListOf(Answer(), Answer()) }
    var running by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun startComparison() {
        if (key == null) {
            val message = "Нет OPENAI_API_KEY. Перезапустите IDE после настройки окружения."
            answers.indices.forEach { answers[it] = Answer(status = message) }
            return
        }

        running = true
        usedControls = controls
        val promptAtStart = prompt
        val modelAtStart = model
        val controlsAtStart = controls
        scope.launch {
            try {
                compareAnswers(promptAtStart, modelAtStart, controlsAtStart, key) { index, answer ->
                    answers[index] = answer
                }
            } finally {
                running = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("День 2 · Управление ответом", style = MaterialTheme.typography.h5)
        OutlinedTextField(
            value = prompt,
            onValueChange = { prompt = it },
            modifier = Modifier.fillMaxWidth(),
            enabled = !running,
            label = { Text("Один вопрос для двух запросов") },
            maxLines = 3,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Choice("Модель", model, MODELS, !running) { model = it }
            Button(
                enabled = !running && prompt.isNotBlank(),
                onClick = ::startComparison,
            ) {
                Text(if (running) "Генерация…" else "Сравнить · 2 API-запроса")
            }
        }
        Text(
            if (key != null) {
                "Ключ доступен в процессе · без проверки действительности в API"
            } else {
                "Этот процесс не получил OPENAI_API_KEY. " +
                    "Закройте тестовое окно и запустите приложение из терминала с ключом."
            },
            style = MaterialTheme.typography.body2,
        )
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            answers.forEachIndexed { index, answer ->
                AnswerCard(index, answer, controls, usedControls, running) { controls = it }
            }
        }
        Text(
            "Ключ — только из OPENAI_API_KEY. Каждый запуск платный; ответы не сохраняются приложением.",
            style = MaterialTheme.typography.caption,
        )
    }
}

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "AI Tutors · Response Control",
        state = rememberWindowState(width = 1180.dp, height = 860.dp),
    ) {
        MaterialTheme {
            Surface {
                App()
            }
        }
    }
}
