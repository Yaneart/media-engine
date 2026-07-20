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

Для опциональных стриминговых провайдеров у движка также есть `getAvailability()`.

## Что экспортирует core

- `MediaEngine`;
- типы поиска, деталей, медиа и стриминга;
- контракты metadata- и streaming-провайдеров;
- интерфейсы объединения и кеша;
- `MemoryCache`;
- нормализованные ошибки и сведения о сбоях провайдеров;
- mock-провайдеры и примеры данных для тестов.

Провайдеры запускаются параллельно. Если один источник не сработал, а другой вернул данные, полезный ответ сохранится, а ошибка попадёт в `meta.providers.failed`. Search-ошибки и debug timings содержат опциональную фазу выполнения `phase`; повторные ошибки одного провайдера представлены одной записью в публичном списке. Обязательная retryable-деградация primary/fallback не записывается в normal cache.

Ошибки опционального ID/poster enrichment не удаляют базовые результаты. Они формируют ограниченные `meta.warnings`, могут кэшироваться вместе с предупреждениями, а в debug-режиме предоставляют счетчики attempted/skipped/succeeded/failed и phase-aware timings.

`MemoryCache` может сохранять метаданные в отдельном ограниченном stale-окне. `MediaEngine` использует их только для поиска и деталей, когда все выбранные провайдеры завершились с retryable-ошибками; устаревшие streaming-ссылки никогда не возвращаются. В таком ответе `meta.cached` и `meta.stale` равны `true`.

Публичные search, details и availability запросы приводятся к canonical-виду до выбора провайдеров и построения cache/coalescing keys: строки и ID обрезаются, язык переводится в нижний регистр, top-level ID shortcuts переносятся в `ids`, а streaming provider filters обрезаются, дедуплицируются и сортируются. Известные форматы IMDb/numeric ID и длины полей валидируются. Search с `limit: 0` возвращает пустой некешированный ответ без обращений к провайдерам или cache.

`MemoryCache` принимает для TTL только неотрицательные safe integer значения. Для записей без срока истечения не задавайте `defaultTtlMs` и per-entry `ttlMs`; отрицательные значения не являются no-expiry sentinel. Для stale TTL действует та же числовая валидация.

`search`, `getDetails` и `getAvailability` принимают опциональные operation options `{ signal }`. Одинаковые запросы по-прежнему делят одну provider operation, но у каждого caller отдельная подписка: отмена одного caller не влияет на остальных, а общий provider signal отменяется, когда активных подписчиков не осталось. Полностью отмененная работа не кешируется, а client cancellation не считается upstream-сбоем circuit breaker.

Если streaming-провайдер возвращает `null`, это считается успешным запросом без результата. Ошибка all-failed возникает, только когда действительно завершились ошибкой все выбранные streaming-провайдеры. Найденные плееры с неопределённым результатом проверки остаются в ответе с `availability: "unknown"`; engine добавляет `STREAM_VALIDATION_DEGRADED` и повторяет lookup вместо записи такого ответа в обычный availability-кеш.

Конструктор также принимает стриминговые провайдеры, кеш, общий и индивидуальные тайм-ауты, собственную стратегию объединения и debug-режим. По умолчанию одновременно выполняются не более двух операций каждого провайдера, а отменяемая очередь ограничена 100 элементами; `providerConcurrency` позволяет настроить отдельные лимиты или отключить gate. Ожидание в очереди входит в существующий тайм-аут провайдера. Сам core никогда не импортирует пакеты с конкретными провайдерами.

Точные типы доступны через exports пакета. В коротком [описании публичного API](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) разобраны три основные операции без перечисления каждого поля.

## Лицензия

MIT
