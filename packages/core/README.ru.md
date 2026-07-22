# @media-engine/core

[English](https://github.com/Yaneart/media-engine/blob/main/packages/core/README.md) | **Русский**

Это часть Media Engine, которая отвечает за основную логику: выбирает провайдеры, запускает их, объединяет ответы, кеширует результат и приводит ошибки к предсказуемому виду.

Самих источников данных в core нет. Для них установите ещё и `@media-engine/providers`.

## Установка

```bash
npm install @media-engine/core @media-engine/providers
```

## Простой пример

```ts
import { MediaEngine } from "@media-engine/core";
import { cinemetaProvider, kinobdProvider } from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), cinemetaProvider()],
});

const search = await media.search({ title: "Интерстеллар" });
const details = await media.getDetails({ imdb: "tt0816692" });

console.log(search.results[0]?.item);
console.log(details.details);
```

Для загрузки деталей нужен внешний ID с указанием источника — через `ids` или сокращение вроде `imdb`. Обычное поле `id` устарело, потому что внутренние ID разных провайдеров не образуют общее пространство имён.

Для опциональных стриминговых провайдеров у движка также есть `getAvailability()`, а для torrent discovery — отдельный контракт `discoverTorrents()`.

## Что экспортирует core

- `MediaEngine`;
- типы поиска, деталей, медиа, стриминга и torrent discovery;
- контракты metadata-, streaming- и torrent-провайдеров;
- интерфейсы объединения и кеша;
- `MemoryCache`;
- нормализованные ошибки и сведения о сбоях провайдеров;
- mock-провайдеры и примеры данных для тестов.

Провайдеры запускаются параллельно. Если один источник не сработал, а другой вернул данные, полезный ответ сохранится, а ошибка попадёт в `meta.providers.failed`. Search-ошибки и debug timings содержат опциональную фазу выполнения `phase`; повторные ошибки одного провайдера представлены одной записью в публичном списке. Обязательная retryable-деградация primary/fallback не записывается в normal cache.

Title search разделяет основные discovery-источники и более медленные fallback identity-источники через опциональный `capabilities.search.titleDiscovery`. Пользовательские провайдеры по умолчанию считаются primary. Поддерживаемые multi-word опечатки расширяются через primary-провайдеры при отсутствии точного title, даже если присутствует weak fuzzy noise. Fallback-провайдеры запускаются при пустом результате, отсутствии точной identity у multi-word запроса или конфликтующих точных title-identity. Поиск по внешнему ID по-прежнему сразу вызывает все совместимые провайдеры.

При настроенном cache первая здоровая mandatory discovery, у top-кандидата которой есть strong external ID, отдельно сохраняет identity snapshot на 30 минут без продления этого окна. Эквивалентные cache misses с другим `limit` используют до 20 общих подтвержденных кандидатов и сохраняют их известный порядок, даже если успешный upstream-ответ меняется. Такая стабилизация добавляет `SEARCH_IDENTITY_SNAPSHOT_STABILIZED`. Retryable-деградированный частичный поиск использует `SEARCH_IDENTITY_SNAPSHOT_FALLBACK`, сохраняя `meta.providers.failed`, `meta.cached: false` и запрет обычного кеширования. Оба пути не принимают конфликтующий strong ID; при non-retryable-деградации snapshot не применяется, а слабый top-кандидат без strong ID не может создать snapshot. Debug-режим показывает счетчики restored/reordered. У первого холодного деградированного запроса snapshot для восстановления ещё нет.

Отдельный `capabilities.searchEnrichment: false` исключает провайдер из best-effort ID/poster enrichment поисковых карточек. Так короткий optional enrichment deadline не расходует reliability budget обязательного fallback identity-источника.

Ошибки опционального ID/poster enrichment не удаляют базовые результаты. Они формируют ограниченные `meta.warnings`, могут кэшироваться вместе с предупреждениями, а в debug-режиме предоставляют счетчики attempted/skipped/succeeded/failed и phase-aware timings. Единый planner ограничивает enrichment ограниченным top discovery window, максимум шестью дополнительными вызовами, двумя вызовами одного провайдера и общим временем 1,5 секунды. Он пропускает провайдеры, неспособные улучшить отсутствующее поле, и переиспользует совпадающий ID-search, а также cached или in-flight details для выбора poster.

Mandatory discovery и подходящее snapshot recovery фиксируют identity, score и порядок результатов до optional enrichment. Совпавшее enrichment может добавить presentation-поля, непротиворечивые external IDs и source attribution, включая aliases, которые делают ранее unresolved candidate релевантным. Оно не добавляет provider candidates как новые результаты, не меняет `id`, `type`, `title`, `originalTitle` или `year`, не пересчитывает score и не переставляет ответ. При конфликте добавляемого ID сохраняется discovery-значение и формируется `EXTERNAL_ID_CONFLICT`.

Mandatory ranking предпочитает близкие по длине multi-word title completions и external IDs, пригодные для надёжного cross-catalog follow-up. Популярные anime catalog identities остаются конкурентными при подтверждённой аудитории; малые audience counters и ratings без vote count не получают полный ranking weight.

Встроенная стратегия сохраняет первый результат и все score, но внутри top-10 может поднять сопоставимый кандидат после двух результатов одной normalized matched-title/media-type family. Альтернатива должна отличаться не более чем на `0.03` по score и `0.05` по title relevance, поэтому слабый шум не продвигается только ради разнообразия. В debug-режиме результат получает опциональный `ranking` с formula, match/title evidence, взвешенными signal contributions и позициями raw score/diversity/final; в обычном ответе этого поля нет.

`MemoryCache` может сохранять метаданные в отдельном ограниченном stale-окне. `MediaEngine` использует их только для поиска и деталей, когда все выбранные провайдеры завершились с retryable-ошибками; устаревшие streaming-ссылки никогда не возвращаются. В таком ответе `meta.cached` и `meta.stale` равны `true`.

Публичные search, details, availability и torrent-discovery запросы приводятся к canonical-виду до выбора провайдеров и построения cache/coalescing keys: строки и ID обрезаются, язык переводится в нижний регистр, top-level ID shortcuts переносятся в `ids`, а provider filters обрезаются, дедуплицируются и сортируются. Известные форматы IMDb/numeric ID и длины полей валидируются. Search и torrent discovery с `limit: 0` возвращают пустые некешированные ответы без обращений к провайдерам или cache.

`MemoryCache` принимает для TTL только неотрицательные safe integer значения. Для записей без срока истечения не задавайте `defaultTtlMs` и per-entry `ttlMs`; отрицательные значения не являются no-expiry sentinel. Для stale TTL действует та же числовая валидация.

`search`, `getDetails`, `getAvailability` и `discoverTorrents` принимают опциональные operation options `{ signal }`. Одинаковые запросы по-прежнему делят одну provider operation, но у каждого caller отдельная подписка: отмена одного caller не влияет на остальных, а общий provider signal отменяется, когда активных подписчиков не осталось. Полностью отмененная работа не кешируется, а client cancellation не считается upstream-сбоем circuit breaker.

Если streaming-провайдер возвращает `null`, это считается успешным запросом без результата. Ошибка all-failed возникает, только когда действительно завершились ошибкой все выбранные streaming-провайдеры. Найденные плееры с неопределённым результатом проверки остаются в ответе с `availability: "unknown"`; engine добавляет `STREAM_VALIDATION_DEGRADED` и повторяет lookup вместо записи такого ответа в обычный availability-кеш.

Конструктор также принимает streaming- и torrent-провайдеры, кеш, общий и индивидуальные тайм-ауты, собственную стратегию объединения и debug-режим. По умолчанию одновременно выполняются не более двух операций каждого провайдера, а отменяемая очередь ограничена 100 элементами; `providerConcurrency` позволяет настроить отдельные лимиты или отключить gate. Ожидание в очереди входит в существующий тайм-аут провайдера. Сам core никогда не импортирует пакеты с конкретными провайдерами.

Torrent discovery не смешивается со streaming availability. `TorrentProvider` возвращает нормализованные кандидаты с source attribution и явным handoff типа `magnet`, `torrent_file` или `external`. Core не открывает handoff, не загружает torrent metadata, не подключается к swarm, не выбирает файлы, не хранит media, не проксирует трафик и не транскодирует видео. В этом contract-only блоке конкретного torrent-провайдера нет.

Точные типы доступны через exports пакета. В коротком [описании публичного API](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) разобраны четыре основные операции без перечисления каждого поля.

## Лицензия

MIT
