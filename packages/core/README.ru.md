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

Провайдеры запускаются параллельно. Если один источник не сработал, а другой вернул данные, полезный ответ сохранится, а ошибка попадёт в `meta.providers.failed`.

`MemoryCache` может сохранять метаданные в отдельном ограниченном stale-окне. `MediaEngine` использует их только для поиска и деталей, когда все выбранные провайдеры завершились с retryable-ошибками; устаревшие streaming-ссылки никогда не возвращаются. В таком ответе `meta.cached` и `meta.stale` равны `true`.

Конструктор также принимает стриминговые провайдеры, кеш, общий и индивидуальные тайм-ауты, собственную стратегию объединения и debug-режим. По умолчанию одновременно выполняются не более двух операций каждого провайдера, а отменяемая очередь ограничена 100 элементами; `providerConcurrency` позволяет настроить отдельные лимиты или отключить gate. Ожидание в очереди входит в существующий тайм-аут провайдера. Сам core никогда не импортирует пакеты с конкретными провайдерами.

Точные типы доступны через exports пакета. В коротком [описании публичного API](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md) разобраны три основные операции без перечисления каждого поля.

## Лицензия

MIT
