# topvisor-mcp — План реализации публичного MCP-сервера для Topvisor API v2

**Статус:** ТЗ + архитектура для dev-coder. Код по этому документу пишет **dev-coder** (не architect).
**Дата:** 2026-06-22
**Автор:** dev-architect
**Образец:** `@scom82/rush-analytics-mcp` (`~/Documents/dev/rush-analytics-mcp`) — повторяем стек, tooling, паттерны транспорта и публикации.
**Цепочка:** dev-architect (этот документ) → dev-coder (реализация) → dev-qa (тесты) → dev-publisher (npm).

---

## 0. TL;DR

- Публичный stdio MCP-сервер на TypeScript + `@modelcontextprotocol/sdk` + `zod`, публикуется в npm, ставится через `npx`.
- Конфиг через env: `TOPVISOR_USER_ID` + `TOPVISOR_API_KEY` (+ опц. `TOPVISOR_API_URL`, `TOPVISOR_HTTP_TIMEOUT_MS`).
- **npm-имя: `@scom82/topvisor-mcp`** (scoped, как у rush; имя свободно — проверено 2026-06-22).
- **v1: 17 tools.** Приоритет — съём и чтение позиций по Яндексу (проект → поисковик → регион → ключи → checker/go → history/summary).
- **Ключевое отличие от Rush:** Topvisor — **stateful** (модель проекта) и большинство методов **синхронны** (`get` возвращает данные сразу), кроме `checker/go` (submit-and-poll). Rush — stateless create→poll.
- **Подтверждено эмпирически (read-only probes 2026-06-22):** все ответы **HTTP 200**, ошибки в `{"result":null,"errors":[{"code":<int>,"string":"...","detail":{...}}]}`. Auth-ошибка → `code:53`. Заголовок `Authorization: bearer <key>` (строчное `bearer`). Признак ошибки — `result===null || errors?.length`, **не HTTP-код**.

---

## 1. Карта API surface

### 1.1 Транспорт (подтверждено доками + эмпирически)

| Параметр | Значение |
|---|---|
| URL | `POST https://api.topvisor.com/v2/json/{operator}/{service}/{method}` |
| Verb | **POST для всех методов** (даже `get`) |
| Заголовки | `Content-Type: application/json`, `User-Id: <user_id>`, `Authorization: bearer <api_key>` |
| Тело | raw JSON: общие селекторы (`fields`,`filters`,`orders`,`limit`,`offset`) + параметры метода на верхнем уровне |
| Успех | `{"result": <array|object>, "limitedBy"?: int, "total"?: int}` |
| Ошибка | **HTTP 200** + `{"result": null, "errors": [{"code": <int>, "string": "...", "detail": <object|string>}]}` |
| Операторы | `get` (читать), `add` (создать), `edit` (правка/действие), `del` (удалить) |

**Эмпирически проверенные ошибки** (probe с невалидными creds):
- code `53` — "Authorisation error" / "Header 'X' is missing" (auth-гейт срабатывает ПЕРВЫМ, до валидации body/verb).
- code `1002` — "Passed parameter value mismatch: 'oper'" (неизвестный оператор).
- ⚠️ Полный список кодов (`/api/v2/errors/codes/`) не выгружен — в коде НЕ хардкодим маппинг кодов в человекочитаемый текст, прокидываем `string` из ответа как есть.

### 1.2 Базовые параметры (селекторы) — подтверждено

- **`fields`** — массив строк-имён полей. Дефолт зависит от метода.
- **`filters`** — массив объектов `{"name":"<field>","operator":"<OP>","values":[...]}`. `values` **всегда массив**, даже для EQUALS.
- **`orders`** — массив `{"name":"<field>","direction":"ASC"|"DESC"}`.
- **`limit`** — число или **строка** (в офиц. примере `"limit":"10"`). Сериализуем толерантно.
- **`offset`** — int.
- **`id`** (сахар верхнего уровня) = `{"name":"id","operator":"EQUALS","values":["<id>"]}`.
- **Операторы (точные токены):** `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `GREATER_THAN`, `GREATER_THAN_EQUALS`, `LESS_THAN`, `LESS_THAN_EQUALS`, `BETWEEN`, `STARTS_WITH`, `CONTAINS`, `DOES_NOT_CONTAIN`, `REGEXP`, `NOT_REGEXP`, `IS_NULL`, `IS_NOT_NULL`.

### 1.3 Сервисы × методы — полная карта (что в v1, что отложено)

Легенда: ✅ = в v1 как отдельный typed-tool; 🟡 = доступен через generic `topvisor_request`; ⏸ = отложено (через generic при необходимости); ⚠️ = параметры не выгружены из доков, нужна live-проверка.

#### projects_2
| Метод | v1 | Примечание |
|---|---|---|
| `get/projects_2/projects` | ✅ `topvisor_list_projects` | список проектов |
| `add/projects_2/projects` | ✅ `topvisor_add_project` | mandatory `url`; opt `name`,`tags` |
| `edit/projects_2/projects/name`,`on`,`tags`,`favorite`,`move`,`sort`,`copy` | ⏸ 🟡 | через generic; ⚠️ params |
| `del/projects_2/projects` | 🟡 | через generic; ⚠️ params |
| `projects_2/competitors` (get/add/edit/del) | ⏸ | конкуренты, отложено; ⚠️ |

#### keywords_2
| Метод | v1 | Примечание |
|---|---|---|
| `get/keywords_2/keywords` | ✅ `topvisor_list_keywords` | mandatory `project_id` |
| `add/keywords_2/keywords/import` | ✅ `topvisor_import_keywords` | CSV bulk — **надёжный путь добавления** |
| `add/keywords_2/keywords` (single) | ⏸ 🟡 | ⚠️ **params не выгружены** — НЕ делаем typed-tool, пока не проверено live. Bulk import закрывает потребность. |
| `get/keywords_2/keywords/export` | ⏸ 🟡 | ⚠️ |
| `edit/keywords_2/keywords/*` (rename,tags,target,move,sort,undel,export/toProject) | ⏸ 🟡 | ⚠️ |
| `del/keywords_2/keywords` | 🟡 | через generic; ⚠️ |
| `keywords_2/groups` (папки) | ⏸ 🟡 | ⚠️ |

#### positions_2 — **ПРИОРИТЕТ v1**
| Метод | v1 | Примечание |
|---|---|---|
| `add/positions_2/searchers` | ✅ `topvisor_add_searcher` | mandatory `project_id`,`searcher_key` |
| `add/positions_2/searchers_regions` | ✅ `topvisor_add_region` | mandatory `project_id`,`searcher_key`,`region_key`; opt `region_lang`,`region_device`,`region_depth` |
| `get/positions_2/searchers_regions/export` | ✅ `topvisor_list_regions` | **критично:** читает `region_index` для добавленных регионов; ⚠️ точные params не выгружены → передаём `project_id` + прокидываем тело generic-стилем |
| `get/positions_2/checker/price` | ✅ `topvisor_check_price` | предпросмотр стоимости съёма |
| `edit/positions_2/checker/go` | ✅ `topvisor_check_positions` | **запуск съёма (ASYNC submit)** → `result.projectsIds` |
| `get/positions_2/history` | ✅ `topvisor_get_history` | чтение истории позиций |
| `get/positions_2/summary` | ✅ `topvisor_get_summary` | сводка по двум датам |
| `get/positions_2/summary_chart` | ✅ `topvisor_get_summary_chart` | данные для графика |
| `edit/positions_2/searchers/enabled`,`sort`; `edit/positions_2/searchers_regions`(settings),`sort`; `edit/positions_2/settings` | ⏸ 🟡 | ⚠️ params; через generic |
| `add/positions_2/searchers_regions/import` | ⏸ 🟡 | ⚠️ |
| `del/positions_2/searchers`,`searchers_regions` | 🟡 | через generic; ⚠️ |

#### snapshots_2
| Метод | v1 | Примечание |
|---|---|---|
| `get/snapshots_2/history` | ✅ `topvisor_get_snapshots` | чтение SERP-снапшотов (собираются через `checker/go do_snapshots=1`) |
| `get/snapshots_2/competitors` | ⏸ 🟡 | ⚠️ |

#### bank_2
| Метод | v1 | Примечание |
|---|---|---|
| `get/bank_2/info` | ✅ `topvisor_balance` | баланс (`balance_all`/`personal`/`bonus`/`plan` + tariff) |
| `get/bank_2/history` (alias `log`?) | ✅ `topvisor_bank_history` | лог операций; ⚠️ `history` подтверждён live-примером, `log` — под вопросом → дефолт `history`, env/параметр не нужен |

#### Служебные (без API-вызова)
| Tool | Назначение |
|---|---|
| `topvisor_services` | список сервисов/операторов/методов + searcher_key reference. Без API-вызова, работает без ключа. |
| `topvisor_request` | **generic escape hatch:** произвольный `{operator}/{service}/{method}` + body. Полное покрытие API без ожидания typed-обёрток. |

**Итого v1: 17 tools** (15 typed + `topvisor_services` + `topvisor_request`).

---

## 2. Список MCP-tools (input schema, маппинг, дефолты)

Везде где не указано иное — output = `{ "content": [{ "type":"text", "text": JSON.stringify(response, null, 2) }] }`, при ошибке Topvisor (`result===null || errors.length`) → `isError:true` + текст с массивом `errors`.

Общие zod-фрагменты:

```ts
const Filter = z.object({
  name: z.string(),
  operator: z.enum(["EQUALS","NOT_EQUALS","IN","NOT_IN","GREATER_THAN",
    "GREATER_THAN_EQUALS","LESS_THAN","LESS_THAN_EQUALS","BETWEEN",
    "STARTS_WITH","CONTAINS","DOES_NOT_CONTAIN","REGEXP","NOT_REGEXP",
    "IS_NULL","IS_NOT_NULL"]),
  values: z.array(z.union([z.string(), z.number()])),
});
const Order = z.object({ name: z.string(), direction: z.enum(["ASC","DESC"]) });
const limitSchema = z.union([z.number().int(), z.string()]).optional();
```

### Группа: служебные

**`topvisor_services`** — input `{}`. Без API-вызова, работает без creds.
Возвращает: список сервисов/операторов/методов (из этого документа), таблицу `searcher_key` (0=Yandex,1=Google,4=YouTube,5=Bing,7=Seznam,8=AppStore,9=GooglePlay,20=Yandex.com,21=Yandex.com.tr), список операторов фильтров, и пометку «region_key ≠ region_index».

**`topvisor_request`** — generic.
Input:
```ts
{
  operator: z.enum(["get","add","edit","del"]),
  service: z.string().describe("e.g. projects_2, keywords_2, positions_2, snapshots_2, bank_2"),
  method: z.string().describe('Method path, e.g. "projects", "checker/go", "searchers_regions/export"'),
  body: z.record(z.any()).default({}).describe("Request body, passed verbatim as JSON"),
}
```
Маппинг: `POST /v2/json/{operator}/{service}/{method}` body=`body`. Возвращает сырой ответ.
Назначение: полное покрытие API, включая все ⚠️-методы, не дожидаясь typed-обёрток.

### Группа: bank_2

**`topvisor_balance`** → `get/bank_2/info`, body `{}`. Возвращает Balance object.

**`topvisor_bank_history`** → `get/bank_2/history`.
Input: `fields?: string[]` (def `["date","info","sum"]`), `orders?: Order[]`, `limit?`, `offset?: number`.

### Группа: projects_2

**`topvisor_list_projects`** → `get/projects_2/projects`.
Input:
```ts
{
  fields: z.array(z.string()).default(["id","name","site"]),
  filters: z.array(Filter).optional(),
  orders: z.array(Order).optional(),
  limit: limitSchema, offset: z.number().int().optional(),
  show_site_stat: z.boolean().optional(),
  show_searchers_and_regions: z.union([z.literal(0),z.literal(1),z.literal(2)]).optional(),
}
```

**`topvisor_add_project`** → `add/projects_2/projects`.
Input: `url: z.string()` (mandatory), `name?: string`, `tags?: number[]` (enum 1..10, def сервер).
Возвращает новый проект (⚠️ точная форма ответа в доках не показана — прокидываем как есть).

### Группа: keywords_2

**`topvisor_list_keywords`** → `get/keywords_2/keywords`.
Input:
```ts
{
  project_id: z.number().int(),                  // mandatory
  fields: z.array(z.string()).default(["id","name"]),
  filters: z.array(Filter).optional(),
  orders: z.array(Order).optional(),
  limit: limitSchema, offset: z.number().int().optional(),
  currency: z.enum(["RUB","USD"]).optional(),
  show_trash: z.boolean().optional(),
}
```

**`topvisor_import_keywords`** → `add/keywords_2/keywords/import`.
Input:
```ts
{
  project_id: z.number().int(),                  // mandatory
  keywords: z.string().describe("CSV data: first row = field names (name mandatory; optional tags,target,group_folder_path,group_name); subsequent rows = keywords"),
  folder_id: z.number().int().optional(),
  group_id: z.number().int().optional(),
  group_name: z.string().optional(),
  move_duplicate: z.boolean().optional(),
  move_duplicate_folder_id: z.number().int().optional(),
  move_duplicate_group_id: z.number().int().optional(),
  move_duplicate_group_name: z.string().optional(),
}
```
Возвращает `{countSended, countDuplicated, countAdded, countChanged}`.
В description: keyword должен попасть в группу — задавать `group_name` или колонку `group_name`/`group_folder_path` в CSV.

### Группа: positions_2 (приоритет)

**`topvisor_add_searcher`** → `add/positions_2/searchers`.
Input: `project_id: z.number().int()`, `searcher_key: z.number().int()` (с описанием enum: 0=Yandex,1=Google,...).

**`topvisor_add_region`** → `add/positions_2/searchers_regions`.
Input:
```ts
{
  project_id: z.number().int(),
  searcher_key: z.number().int(),                // 0=Yandex и т.д.
  region_key: z.number().int().describe("Region key from Topvisor catalog (e.g. Samara). NOT region_index. Differs per search engine."),
  region_lang: z.string().optional(),
  region_device: z.union([z.literal(0),z.literal(1),z.literal(2)]).optional(), // 0 desktop,1 tablet,2 phone
  region_depth: z.number().int().min(1).max(5).optional(),
}
```
В description явно: после добавления региона его `region_index` для запросов истории читать через `topvisor_list_regions`.

**`topvisor_list_regions`** → `get/positions_2/searchers_regions/export`.
Input: `project_id: z.number().int()` (+ `body` passthrough на случай доп. params, ⚠️ точные params не выгружены).
Назначение: получить маппинг добавленных регионов → `region_index`. **Критический tool для всего флоу.**

**`topvisor_check_price`** → `get/positions_2/checker/price`.
Input:
```ts
{
  project_id: z.number().int(),  // → внутри в filters:[{name:"id",operator:"EQUALS",values:[project_id]}]
  regions_indexes: z.array(z.number().int()).optional(),
  folders_ids: z.array(z.number().int()).optional(),
  folders_ids_depth: z.boolean().optional(),
  groups_ids: z.array(z.number().int()).optional(),
  do_snapshots: z.union([z.literal(0),z.literal(1)]).optional(),
  apply_discount: z.boolean().optional(),    // def 1
}
```
Возвращает `result.pricesByUsers.<userId> = {projectsIds, price}`.

**`topvisor_check_positions`** → `edit/positions_2/checker/go`. **ASYNC submit.**
Input: тот же набор, что `check_price`, минус `apply_discount`, плюс:
```ts
{
  project_id: z.number().int(),
  regions_indexes: z.array(z.number().int()).optional(),
  folders_ids: z.array(z.number().int()).optional(),
  folders_ids_depth: z.boolean().optional(),
  groups_ids: z.array(z.number().int()).optional(),
  do_snapshots: z.union([z.literal(0),z.literal(1)]).optional(),
  keyword_id: z.number().int().optional(),    // single keyword; требует regions_indexes; игнорит groups_ids/do_snapshots
}
```
Возвращает `result.projectsIds`. В description **ЯВНО**: это submit в очередь съёма (async); фактический сбор идёт в фоне; результат читать позже через `topvisor_get_history` после того как `status_positions` в `topvisor_list_projects` дойдёт до завершения. Для предпросмотра цены — `topvisor_check_price`.

**`topvisor_get_history`** → `get/positions_2/history`.
Input:
```ts
{
  project_id: z.number().int(),                    // mandatory
  regions_indexes: z.array(z.number().int()),      // mandatory
  date1: z.string().optional(),                    // YYYY-MM-DD; пара date1+date2 ИЛИ dates
  date2: z.string().optional(),
  dates: z.array(z.string()).optional(),
  fields: z.array(z.string()).optional(),
  competitors_ids: z.array(z.number().int()).optional(),
  type_range: z.number().int().optional(),         // enum 0..7,100; def 2
  count_dates: z.number().int().max(31).optional(),
  only_exists_first_date: z.boolean().optional(),
  show_headers: z.boolean().optional(),
  show_exists_dates: z.boolean().optional(),
  show_visitors: z.boolean().optional(),
  show_top_by_depth: z.number().int().optional(),
  positions_fields: z.array(z.enum(["position","snippet","relevant_url","visitors"])).optional(),
}
```
**Client-side guard:** требуется либо `dates`, либо (`date1` И `date2`). Иначе `validationError`.
Возвращает `result.keywords[]` с `positionsData` по qualifier-ключам (прокидываем как есть).

**`topvisor_get_summary`** → `get/positions_2/summary`.
Input: `project_id`, `region_index: number` (один!), `dates: z.array(z.string()).length(2)` (две даты), opt `competitor_id`, `only_exists_first_date`, `show_dynamics`, `show_tops`, `show_avg`, `show_visibility` (все bool).

**`topvisor_get_summary_chart`** → `get/positions_2/summary_chart`.
Input: `project_id`, `region_index: number`, (`dates[]` ИЛИ `date1`+`date2`), opt `competitor_id: number[]`, `type_range` (def 2), `only_exists_first_date`, `show_tops`, `show_avg`, `show_visibility`.

### Группа: snapshots_2

**`topvisor_get_snapshots`** → `get/snapshots_2/history`.
Input:
```ts
{
  project_id: z.number().int(),
  region_index: z.number().int(),
  date1: z.string().optional(), date2: z.string().optional(),
  dates: z.array(z.string()).optional(),
  filters: z.array(Filter).optional(),    // keyword filters, ≤100/request
  type_range: z.number().int().optional(),  // def 3
  count_dates: z.number().int().max(31).optional(),
  show_exists_dates: z.boolean().optional(),
  show_ams: z.boolean().optional(),
  positions_fields: z.array(z.enum(["url","domain","snippet_title","snippet_body"])).optional(),
}
```
**Guard:** `dates` ИЛИ (`date1`+`date2`).

---

## 3. Архитектура проекта

Повторяем структуру rush-analytics-mcp.

```
topvisor-mcp/
├── package.json          # @scom82/topvisor-mcp, type:module, bin, files:[dist]
├── tsconfig.json         # копия rush (ES2022, Node16, strict, declaration)
├── .gitignore            # node_modules, dist
├── LICENSE               # MIT
├── README.md
├── PLAN.md               # этот документ
└── src/
    ├── index.ts          # entrypoint: McpServer + StdioServerTransport, register tools
    ├── api-client.ts     # TopvisorApiClient: единый POST-транспорт + error-детект
    └── tools/
        └── core.ts       # registerCoreTools(server, client) — все 18 tools
```

При росте числа typed-tools — разбить `tools/core.ts` на `tools/positions.ts`, `tools/projects.ts` и т.д. Для v1 один файл достаточно (как в rush).

**Стек (идентично rush):**
- `@modelcontextprotocol/sdk` ^1.12.1, `zod` ^3.24.4.
- dev: `@types/node` ^22, `typescript` ^5.8.
- `engines.node >= 18`. ESM (`type:module`, Node16 resolution, `.js`-суффиксы в импортах).
- Транспорт: **stdio** (`StdioServerTransport`).
- Регистрация: `server.tool(name, description, zodShape, handler)`.

**`index.ts`** (по образцу rush):
```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TopvisorApiClient } from "./api-client.js";
import { registerCoreTools } from "./tools/core.js";

const server = new McpServer({ name: "topvisor-mcp", version: "1.0.0" });
const client = new TopvisorApiClient();  // creds валидируются лениво при API-вызове
registerCoreTools(server, client);
const transport = new StdioServerTransport();
await server.connect(transport);
```
`topvisor_services` и `tools/list` работают **без creds** (lazy validation — как в rush).

**`api-client.ts`** — единая `request(operator, service, method, body)`:
- Строит URL `${baseUrl}/${operator}/${service}/${method}`, baseUrl из env (def `https://api.topvisor.com/v2/json`).
- Заголовки: `Content-Type`, `User-Id`, `Authorization: bearer ${apiKey}`.
- `assertCreds()` — кидает понятную ошибку если `TOPVISOR_USER_ID`/`TOPVISOR_API_KEY` пусты.
- `AbortController` + timeout (env `TOPVISOR_HTTP_TIMEOUT_MS`, def 30000) — как в rush.
- Парсит JSON. **Детект ошибки Topvisor:** `if (data?.result === null && Array.isArray(data?.errors) && data.errors.length)` → возвращает `{ ok:false, errors }`. Иначе `{ ok:true, result, limitedBy, total }`.
- НЕ полагается на HTTP-код для детекта ошибки (всё приходит 200). Но если придёт не-2xx и тело не распарсилось — кидает обычную ошибку с path+status (без логирования ключа).
- **Безопасность логов:** никогда не логировать `Authorization`/`User-Id`/`api_key`. В сообщениях об ошибке — только `operator/service/method` + статус.

---

## 4. Аутентификация

| Env | Required | Default | Описание |
|---|---|---|---|
| `TOPVISOR_USER_ID` | да (для API-вызовов) | — | User-Id (email-связанный числовой/строковый id кабинета) |
| `TOPVISOR_API_KEY` | да (для API-вызовов) | — | API-ключ из кабинета Topvisor |
| `TOPVISOR_API_URL` | нет | `https://api.topvisor.com/v2/json` | override базового URL |
| `TOPVISOR_HTTP_TIMEOUT_MS` | нет | `30000` | таймаут запроса |

- Сервер **стартует без creds** — `tools/list` и `topvisor_services` работают.
- При первом tool с API-вызовом без creds → понятная ошибка: `"TOPVISOR_USER_ID and TOPVISOR_API_KEY must be set in the environment"`.
- В README — пример конфига Claude Desktop / Claude Code с обоими env.
- **Локальная интеграция в vault** (отдельный шаг, не часть npm-пакета): wrapper `_system/scripts/topvisor-mcp.sh` (source secrets → `npx -y @scom82/topvisor-mcp`), creds `TOPVISOR_USER_ID`/`TOPVISOR_API_KEY` в `~/.secrets/secrets.env` (и перешифровать `.age`). Подключение к нужному агенту (вероятно `seo`) через его `.mcp.json`. Это задача отдельным тикетом после публикации, не код пакета.

---

## 5. Обработка ошибок

**Формат (подтверждён эмпирически):** HTTP 200, тело `{"result":null,"errors":[{"code":<int>,"string":"<msg>","detail":<object|string>}]}`.

Правила:
1. **Канонический признак ошибки** — `result === null && errors.length > 0` (НЕ HTTP-код).
2. Tool-handler при ошибке Topvisor возвращает MCP-ошибку:
   ```ts
   { content:[{type:"text", text: JSON.stringify({ isError:true, errors }, null, 2)}], isError:true }
   ```
   Прокидываем `errors[]` как есть (с `code`+`string`+`detail`) — не переводим коды, полного справочника кодов нет.
3. **Известные коды** (для description/README, не для логики): `53` = ошибка авторизации (неверные `User-Id`/`API_KEY` или отсутствуют заголовки); `1002` = несоответствие значения параметра (`Passed parameter value mismatch`).
4. **Сетевые/таймаут:** `AbortError` → `"Request timed out after Nms"`. Прочие fetch-ошибки прокидываются.
5. **Не-2xx с непарсящимся телом:** `throw new Error("HTTP <status> on <operator>/<service>/<method>")` — без URL (в нём нет ключа, но политика — не светить детали).
6. **Ретраи:** в v1 НЕ делаем автоматические ретраи. Лимиты Topvisor (rate limit) в доках не специфицированы (⚠️ непроверено) — если на тестах словим лимит-ошибку, добавим backoff в v1.1. Документируем как known-gap.
7. **Client-side guards** (до запроса, экономят вызов): `get_history`/`get_snapshots` — требуется `dates` ИЛИ `date1`+`date2`; `get_summary` — `dates` ровно 2 элемента.

---

## 6. Особенность проектной модели (stateful)

Topvisor — **stateful**, в отличие от stateless Rush (там один create→poll на задачу). Иерархия:

```
Project (add/projects_2/projects → project_id)
  └─ Searcher (add/positions_2/searchers, searcher_key: 0=Yandex)
       └─ Region (add/positions_2/searchers_regions, region_key)
            → region_index (читается обратно через searchers_regions/export)
  └─ Keywords (import keywords/import, в группу)
  └─ checker/go (edit, ASYNC submit) → projectsIds
       → данные накапливаются в фоне
  └─ history / summary / summary_chart (get, sync чтение)
```

**Два класса tools отражают это:**
- **Setup-tools** (создают состояние): `add_project`, `add_searcher`, `add_region`, `import_keywords`.
- **Action/read-tools** (работают по существующему проекту): `check_price`, `check_positions` (submit), `list_regions`, `get_history`, `get_summary`, `get_summary_chart`, `get_snapshots`, `list_projects`, `list_keywords`.

**Две ловушки — в description каждого затронутого tool:**

1. **`region_key` (add-time) ≠ `region_index` (query-time).** При добавлении региона задаёшь `region_key` (из каталога Topvisor, напр. Самара). Для `get_history`/`checker_go` нужен `region_index`, который присваивается ПОСЛЕ добавления. Маппинг читать через `topvisor_list_regions`. ⚠️ Доки не специфицируют, как `region_key`→`region_index` — поэтому НЕ предполагаем равенство, всегда читаем обратно.

2. **`checker/go` асинхронен.** Возвращает `projectsIds` сразу (submit), сбор идёт в фоне. Результат — позже через `get_history` после готовности (`status_positions`/`positions_percent` в `list_projects`). В v1 НЕ делаем авто-poll внутри tool (в отличие от rush `wait`), т.к. сбор позиций долгий (минуты-часы) и зависит от расписания/очереди Topvisor. Документируем флоу в README.

**Helper-флоу (документируем в README как рецепт, НЕ как отдельный мега-tool в v1):**
```
1. topvisor_add_project { url: "https://green-line24.ru" }              → project_id
2. topvisor_add_searcher { project_id, searcher_key: 0 }                 # Yandex
3. topvisor_add_region   { project_id, searcher_key: 0, region_key: <Самара>, region_depth: 1 }
4. topvisor_list_regions { project_id }                                  → region_index
5. topvisor_import_keywords { project_id, group_name:"main", keywords:"name\nкупить окна\nокна цены" }
6. topvisor_check_price  { project_id, regions_indexes:[<region_index>] }  # предпросмотр стоимости
7. topvisor_check_positions { project_id, regions_indexes:[<region_index>] }  # submit (async)
8. (ждём) topvisor_list_projects { filters:[{name:"id",operator:"EQUALS",values:[project_id]}], fields:["id","status_positions","positions_percent"] }
9. topvisor_get_history { project_id, regions_indexes:[<region_index>], date1, date2 }  → ранги
```
⚠️ `region_key` для Самары: в задаче упомянут «51», но fork-исследование показало, что 51 в нашей памяти/Rush — это **Yandex region id (rids)**, а Topvisor использует **свой каталог `region_key`**, отличающийся по поисковикам. **Реальный `region_key` Самары в Topvisor подтверждает dev-qa live-вызовом** (см. §9). Не хардкодим 51 как Topvisor region_key без проверки.

---

## 7. Публикация

- **npm-имя: `@scom82/topvisor-mcp`** — scoped (консистентно с `@scom82/rush-analytics-mcp`). Свободно (проверено 2026-06-22: HTTP 404). Альтернативы (тоже свободны): `topvisor-mcp` (unscoped), `topvisor-mcp-server`. **Рекомендация: `@scom82/topvisor-mcp`.**
- **`package.json`** (по образцу rush):
  ```jsonc
  {
    "name": "@scom82/topvisor-mcp",
    "version": "1.0.0",
    "description": "Unofficial MCP server for the Topvisor API v2 — Yandex/Google rank tracking: projects, keywords, searchers+regions, position checks, history, summary, SERP snapshots, balance.",
    "type": "module",
    "main": "dist/index.js",
    "bin": { "topvisor-mcp": "dist/index.js" },
    "files": ["dist"],
    "scripts": { "build": "tsc", "start": "node dist/index.js" },
    "keywords": ["mcp","model-context-protocol","topvisor","seo","rank-tracker","positions","yandex","google","serp"],
    "author": "SCom-82",
    "license": "MIT",
    "repository": { "type":"git", "url":"git+https://github.com/SCom-82/topvisor-mcp.git" },
    "engines": { "node": ">=18" },
    "publishConfig": { "access": "public" },
    "dependencies": { "@modelcontextprotocol/sdk":"^1.12.1", "zod":"^3.24.4" },
    "devDependencies": { "@types/node":"^22.15.3", "typescript":"^5.8.3" }
  }
  ```
  ⚠️ `dist/index.js` должен иметь shebang `#!/usr/bin/env node` (он в `index.ts` первой строкой) и быть исполняемым — bin через npx это обеспечивает.
- **README.md** (по образцу rush): «Unofficial / not affiliated» дисклеймер; Installation (npx + from source); Configuration (таблица env); Claude Desktop/Code config-сниппет с `TOPVISOR_USER_ID`+`TOPVISOR_API_KEY`; таблица всех 18 tools; раздел «Stateful project model» с helper-флоу; раздел «region_key vs region_index»; раздел «checker/go is async»; раздел про формат ошибок (HTTP 200 + errors[]); MIT-футер.
- **Версионирование:** SemVer, старт `1.0.0`. v1.1 — добавление отложенных edit/del-tools и/или ретраев после фидбэка.
- **Лицензия:** MIT (как rush).
- **GitHub:** публичный репо `SCom-82/topvisor-mcp` (создаёт dev-publisher/infra при публикации).
- **npm-токен:** аккаунт `scom82`, granular-токен в `~/.npmrc` + `NPM_TOKEN` в secrets (тот же, что для rush; проверить срок — истекает ~28.08.2026).

---

## 8. План по фазам для dev-coder

> Весь код пишет dev-coder. Каждая фаза — отдельный коммит, DoD проверяемый.

**Фаза 0 — Scaffold.** Создать структуру (`package.json`, `tsconfig.json`, `.gitignore`, `LICENSE`, `src/index.ts`, `src/api-client.ts`, `src/tools/core.ts` со stub-экспортом). `npm install`.
**DoD:** `npm run build` проходит без ошибок; `node dist/index.js` стартует и отвечает на `tools/list` (пусть пока 2 служебных tool); shebang на месте.

**Фаза 1 — Транспорт + служебные tools.** Реализовать `TopvisorApiClient.request()` (URL, заголовки, timeout, error-детект `result===null && errors.length`, lazy-creds, безопасные логи). Реализовать `topvisor_services` (без API) и `topvisor_request` (generic).
**DoD:** `topvisor_services` возвращает карту + searcher_key reference без creds; `topvisor_request` с валидными creds успешно вызывает `get/bank_2/info` и возвращает баланс; невалидные creds → читаемая ошибка с `errors[]` (code 53), не краш.

**Фаза 2 — bank_2 + projects_2.** `topvisor_balance`, `topvisor_bank_history`, `topvisor_list_projects`, `topvisor_add_project`. Общий `json()`-helper и `validationError()`-helper (как в rush).
**DoD:** `topvisor_balance` отдаёт `balance_all`; `topvisor_list_projects` отдаёт массив проектов; `topvisor_add_project` создаёт проект и возвращает id.

**Фаза 3 — positions_2 setup.** `topvisor_add_searcher`, `topvisor_add_region`, `topvisor_list_regions`. Описания с предупреждением про `region_key`≠`region_index`.
**DoD:** на тестовом проекте можно добавить Yandex (searcher_key=0) + регион, затем `list_regions` возвращает присвоенный `region_index`.

**Фаза 4 — keywords_2.** `topvisor_list_keywords`, `topvisor_import_keywords`.
**DoD:** import CSV `name\n...` в группу возвращает `{countAdded>0}`; `list_keywords` показывает добавленные ключи.

**Фаза 5 — positions_2 action/read (приоритет).** `topvisor_check_price`, `topvisor_check_positions` (с явным async-предупреждением в description), `topvisor_get_history` (+ guard dates), `topvisor_get_summary`, `topvisor_get_summary_chart`. Внутренняя сборка `filters:[{name:"id",...}]` из `project_id` для checker-методов.
**DoD:** `check_price` отдаёт `price`; `check_positions` отдаёт `projectsIds`; после готовности съёма `get_history` отдаёт `keywords[]` с позициями; guard срабатывает при отсутствии дат.

**Фаза 6 — snapshots_2.** `topvisor_get_snapshots` (+ guard dates).
**DoD:** при наличии собранных снапшотов (`do_snapshots=1` в checker/go) возвращает `snapshotsData`.

**Фаза 7 — README + финал.** README по образцу rush (все разделы из §7). Версия 1.0.0. Проверить `files:["dist"]`, shebang, `npm pack` dry-run.
**DoD:** `npm pack` собирает тарбол только с `dist`+README+LICENSE+package.json; README покрывает все 18 tools, helper-флоу, region_key/index, async-checker, формат ошибок.

> После Фазы 7 — передача dev-qa (§9). Публикацию делает dev-publisher по отдельному тикету после зелёного QA.

---

## 9. Что должен проверить dev-qa

Аккаунт: реальный (USER_ID есть, API_KEY оплачен — **creds выдаст Сергей; их нет в secrets на 2026-06-22, см. риски**). Тестовый домен: `green-line24.ru`. Регион: Самара (Yandex region id 51 — но это rids, **реальный Topvisor `region_key` Самары подтвердить live**).

**Группа A — транспорт/служебные:**
1. `topvisor_services` без creds → возвращает карту + searcher_key reference, не падает.
2. `tools/list` без creds → 17 tools.
3. `topvisor_request get/bank_2/info {}` с валидными creds → баланс.
4. Невалидный API_KEY → `errors:[{code:53,...}]`, `isError:true`, не краш.
5. Отсутствие creds → читаемая ошибка про env.

**Группа B — bank/projects:**
6. `topvisor_balance` → `balance_all` число.
7. `topvisor_bank_history` → массив `{date,info,sum}` + `total`.
8. `topvisor_list_projects` → массив; найти/создать тестовый проект green-line24.ru.
9. `topvisor_add_project {url:"https://green-line24.ru"}` → новый id (если проекта ещё нет; иначе skip, чтобы не плодить дубли).

**Группа C — positions setup (ключевое):**
10. `topvisor_add_searcher {project_id, searcher_key:0}` → Yandex добавлен.
11. **Определить реальный Topvisor `region_key` Самары** — через каталог/перебор; задокументировать найденное значение (сверить с гипотезой 51).
12. `topvisor_add_region {project_id, searcher_key:0, region_key:<Самара>, region_depth:1}` → регион добавлен.
13. `topvisor_list_regions {project_id}` → есть присвоенный `region_index`; **зафиксировать, равен ли он region_key** (проверка ловушки §6).

**Группа D — keywords:**
14. `topvisor_import_keywords {project_id, group_name:"qa", keywords:"name\nпластиковые окна\nостекление балкона"}` → `countAdded≥1`.
15. `topvisor_list_keywords {project_id}` → добавленные ключи видны.

**Группа E — positions action/read (приоритет):**
16. `topvisor_check_price {project_id, regions_indexes:[<region_index>]}` → `price` число > 0.
17. `topvisor_check_positions {project_id, regions_indexes:[<region_index>]}` → `projectsIds` содержит project_id. **(тратит баланс — согласовать с Сергеем перед запуском)**.
18. После готовности съёма (поллить `list_projects` по `status_positions`/`positions_percent`): `topvisor_get_history {project_id, regions_indexes:[<region_index>], date1, date2}` → `keywords[]` с `positionsData`.
19. `topvisor_get_history` без дат → client-side `validationError` (запрос НЕ уходит).
20. `topvisor_get_summary {project_id, region_index, dates:[d1,d2]}` → сводка с tops/dynamics.
21. `topvisor_get_summary_chart {project_id, region_index, date1, date2}` → `dates` + `seriesByProjectsId`.

**Группа F — snapshots:**
22. `topvisor_check_positions` с `do_snapshots:1`, дождаться сбора, затем `topvisor_get_snapshots {project_id, region_index, date1, date2}` → `snapshotsData` (или пустой, если SERP-снапшоты не успели — пометить как known timing).

**Группа G — generic:**
23. `topvisor_request` с произвольным методом (напр. `get/keywords_2/keywords` body `{project_id}`) → совпадает с typed-tool.

**Отчёт dev-qa:** для каждого кейса — pass/fail + сырой ответ (с замаскированными creds). Особо зафиксировать находки по §11 (region_key↔index, наличие лимитов, реальная форма ответа `add_project`).

---

## 10. ADR (краткие)

**ADR-1: Generic `topvisor_request` + typed-обёртки, а не только generic.**
Контекст: API огромный, многие edit/del-методы не выгружены из доков. Варианты: (a) только generic; (b) только typed; (c) оба. Решение: **(c)** — typed для приоритетного позиционного флоу (хорошие schema/описания для LLM), generic как escape hatch для полного покрытия и непроверенных методов. Последствия: 100% покрытие сразу, typed-качество для главного флоу, риск дублирования — приемлемо.

**ADR-2: Детект ошибки по `result===null && errors[]`, не по HTTP-коду.**
Контекст: эмпирически все ответы HTTP 200, ошибки в теле. Решение: канонический признак — тело. Последствия: устойчивый error-handling; но нужно осторожно с не-2xx (fallback на throw).

**ADR-3: `checker/go` без авто-poll в v1.**
Контекст: съём позиций долгий (минуты-часы, очередь/расписание). В rush был `wait`, но там задачи быстрые. Решение: submit-and-return, poll вручную через `list_projects`. Последствия: проще, нет риска MCP-timeout; чуть больше ручной работы у клиента — документируем флоу.

**ADR-4: scoped npm-имя `@scom82/topvisor-mcp`.**
Консистентность с `@scom82/rush-analytics-mcp`, один аккаунт/токен. Все варианты свободны.

---

## 11. Открытые вопросы и риски

1. **Creds отсутствуют в secrets (2026-06-22).** `TOPVISOR_USER_ID`/`TOPVISOR_API_KEY` НЕ найдены в `~/.secrets/secrets.env`. Для QA (Группы C–F) нужны реальные оплаченные creds. **Действие: Сергей предоставляет creds → infra-ops кладёт в secrets + `.age`** (тикет infra-ops). Без них dev-qa проходит только Группу A частично (services/tools-list без ключа) и негативные кейсы.
2. **`region_key` Самары в Topvisor неизвестен.** «51» — это Yandex rids (из памяти/Rush), а Topvisor использует собственный каталог region_key, разный по поисковикам. Риск: захардкодить неверное значение. **Действие: dev-qa определяет live (кейс 11), результат → в README/память.**
3. **`region_key` ↔ `region_index`.** Доки не специфицируют связь. Архитектура страхуется через `list_regions` (читаем обратно). dev-qa кейс 13 подтверждает поведение.
4. **`add/keywords_2/keywords` (single add) — params не выгружены** (SPA-quirk доков). v1 использует `import` (надёжный путь). Single-add — отложен до live-проверки.
5. **Точная форма ответа `add/projects_2/projects`** в доках не показана — прокидываем сырой ответ; dev-qa фиксирует реальную форму (кейс 9).
6. **Rate limits Topvisor не специфицированы.** v1 без ретраев. Если QA словит лимит-ошибку — добавить backoff в v1.1. Known-gap в README.
7. **`bank_2`: `history` vs `log`.** `history` подтверждён live-примером доков, `log` — название секции. v1 использует `get/bank_2/history`. Если на QA не сработает — переключить на `log` через generic, поправить typed-tool.
8. **Полный справочник кодов ошибок** (`/errors/codes/`) не выгружен — не критично, прокидываем `string` из ответа. Известны: 53 (auth), 1002 (param mismatch).
9. **Параметры всех отложенных edit/del-методов** не выгружены — покрыты generic `topvisor_request`; typed-обёртки добавим в v1.1 по мере надобности.

---

*Источники истины: официальные доки topvisor.com/api/v2/ + /api/v2-services/ (deep-research 2026-06-22) + эмпирические read-only probes к api.topvisor.com (формат ошибок, заголовки, HTTP 200) + образец `@scom82/rush-analytics-mcp`. Все места, где доки не специфицируют поведение, помечены ⚠️ и вынесены в §11 как требующие live-проверки dev-qa.*
