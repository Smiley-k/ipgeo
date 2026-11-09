# MeshCentral IP Geo — инструкция по установке

Инструкция описывает ручную установку, установку через веб-интерфейс MeshCentral, настройку, обновление и диагностику.

## Требования

- MeshCentral 1.1.0 или новее.
- Включённые плагины MeshCentral.
- Исходящий HTTP/HTTPS с сервера MeshCentral к <code>ip-api.com</code>. Дополнительные fallback-сервисы: <code>ipwho.is</code> и <code>ipinfo.io</code>.
- Полный администратор сайта для установки через веб-интерфейс.
- Права на запись в папку плагина, если кэш должен переживать перезапуск сервера.

## Что входит в плагин

~~~text
ipgeo/
├── config.json
├── ipgeo.js
├── flags/
│   ├── de.svg
│   ├── us.svg
│   └── ...
├── settings.example.json
├── README.md
├── README.ru.md
├── INSTALL.en.md
├── INSTALL.ru.md
├── CHANGELOG.md
└── LICENSE
~~~

## Вариант A — ручная установка

Подходит для приватного сервера и случая, когда не хотите публиковать плагин на GitHub.

### 1. Скопировать папку

Скопируйте папку <code>ipgeo</code> в:

~~~text
<meshcentral-data>/plugins/ipgeo/
~~~

Структура должна быть такой:

~~~text
meshcentral-data/
└── plugins/
    └── ipgeo/
        ├── config.json
        ├── ipgeo.js
        └── flags/
~~~

Не должно быть лишнего уровня <code>plugins/ipgeo/ipgeo/</code>.

### 2. Включить загрузчик плагинов

Откройте <code><meshcentral-data>/config.json</code> и добавьте <code>plugins</code> внутрь верхнеуровневого объекта <code>settings</code>:

~~~json
{
  "settings": {
    "plugins": {
      "enabled": true,
      "list": ["ipgeo"]
    }
  },
  "domains": { }
}
~~~

Важно:

- <code>plugins</code> должен быть внутри <code>settings</code>, а не в корне файла.
- <code>list</code> — режим ручной загрузки. MeshCentral загружает только перечисленные папки и не загружает плагины из базы/веб-интерфейса.
- Если уже есть плагины, установленные через веб-интерфейс, либо добавьте все их shortName в <code>list</code>, либо используйте вариант B.
- JSON должен оставаться валидным: без комментариев и лишних запятых.

### 3. Перезапустить MeshCentral

~~~bash
sudo systemctl restart meshcentral
~~~

Для Docker:

~~~bash
docker restart <container>
~~~

### 4. Проверить

Откройте веб-интерфейс, обновите страницу с <code>Ctrl+F5</code> и проверьте:

1. Виден раздел <code>My Server → Plugins</code> (при <code>list</code> таблица может быть пустой — это нормально).
2. В списке устройств рядом с публичным IP появился флаг.
3. При наведении на флаг показываются провайдер, страна, ASN и IP.

Проверка в консоли браузера:

~~~js
pluginHandler
typeof pluginHandler.ipgeo.webShowTip
document.querySelector('.ipgeo-b')?.getAttribute('data-tip')
~~~

Ожидается: объект, <code>"function"</code> и строка с провайдером.

## Вариант B — установка через веб-интерфейс

Веб-интерфейс MeshCentral устанавливает плагины только по URL. Загрузки ZIP с диска там нет.

### 1. Опубликовать файлы

Разместите репозиторий на GitHub (или любом веб-сервере, доступном MeshCentral). Публично должны быть доступны:

- <code>config.json</code>
- ZIP-архив, указанный в <code>downloadUrl</code>
- при необходимости <code>CHANGELOG.md</code> и API тегов

Обновите в <code>config.json</code>:

~~~json
{
  "homepage": "https://github.com/Smiley-k/ipgeo",
  "changelogUrl": "https://raw.githubusercontent.com/Smiley-k/ipgeo/main/CHANGELOG.md",
  "configUrl": "https://raw.githubusercontent.com/Smiley-k/ipgeo/main/config.json",
  "downloadUrl": "https://github.com/Smiley-k/ipgeo/archive/refs/heads/main.zip",
  "versionHistoryUrl": "https://api.github.com/repos/Smiley-k/ipgeo/tags"
}
~~~

### 2. Включить плагины без ручного list

~~~json
{
  "settings": {
    "plugins": {
      "enabled": true
    }
  }
}
~~~

Для этого варианта <code>list</code> добавлять не нужно. Перезапустите MeshCentral.

### 3. Установить через веб-интерфейс

1. Войдите полным администратором сайта.
2. Откройте <code>My Server → Plugins</code>.
3. Нажмите <code>Download Plugin</code>.
4. Укажите raw-URL на <code>config.json</code> плагина, например:

~~~text
https://raw.githubusercontent.com/Smiley-k/ipgeo/main/config.json
~~~

5. MeshCentral прочитает конфиг, скачает ZIP по <code>downloadUrl</code> и установит плагин.
6. При необходимости выберите <code>Enable</code> или <code>Install</code> в колонке Actions.

## Настройки

Создайте <code>settings.json</code> рядом с <code>ipgeo.js</code>. За основу возьмите <code>settings.example.json</code>.

~~~json
{
  "provider": "auto",
  "cacheHours": 168,
  "requestTimeoutMs": 5000,
  "minIntervalMs": 1400,
  "batchIntervalMs": 4200,
  "batchSize": 100,
  "batchMax": 200,
  "batchTimeoutMs": 15000,
  "debug": false
}
~~~

| Параметр | По умолчанию | Описание |
|---|---:|---|
| provider | auto | auto, ip-api, ipwho или ipinfo |
| cacheHours | 168 | Время жизни кэша в часах |
| requestTimeoutMs | 5000 | Таймаут одиночного запроса |
| minIntervalMs | 1400 | Интервал между одиночными запросами |
| batchIntervalMs | 4200 | Интервал между batch-запросами |
| batchSize | 100 | IP в одном batch-запросе ip-api |
| batchMax | 200 | Максимум IP в batch от браузера |
| batchTimeoutMs | 15000 | Таймаут batch-запроса |
| debug | false | Отладочные сообщения в лог |

После изменения <code>settings.json</code> перезапустите MeshCentral.

## Обновление плагина

Кэш хранится в <code>cache.json</code> внутри папки плагина. В архив он не входит, поэтому при замене папки кэш удаляется.

Рекомендуемый порядок:

~~~bash
# остановить MeshCentral
sudo systemctl stop meshcentral

# сохранить кэш
cp <meshcentral-data>/plugins/ipgeo/cache.json /tmp/ipgeo-cache.json

# заменить папку плагина на новую версию

# вернуть кэш
cp /tmp/ipgeo-cache.json <meshcentral-data>/plugins/ipgeo/cache.json

# запустить MeshCentral
sudo systemctl start meshcentral
~~~

После обновления обновите страницу с <code>Ctrl+F5</code>.

## Нагрузка, batch и кэш

- Запросы начинаются при отрисовке ссылок на публичные IP, а не при наведении.
- Предзагружаются только видимые строки (вьюпорт + 200 px).
- Видимые IP отправляются одним batch-запросом; сервер использует <code>ip-api.com/batch</code> до 100 IP за запрос.
- Строки за пределами экрана подгружаются при прокрутке, изменении размера, фокусе или возврате на вкладку.
- Успешные ответы кэшируются на 7 дней в <code>cache.json</code>.
- Лимиты бесплатного ip-api: около 45 одиночных запросов/мин и 15 batch-запросов/мин.
- Для списка из 2000 устройств это несколько batch-запросов, а не 2000 одновременных запросов.
- Для полностью локальной работы без внешних GeoIP-запросов нужна база MaxMind/DB-IP, а не этот плагин.

## Диагностика

### Нет раздела Plugins

1. В консоли браузера проверьте <code>pluginHandler</code>. Если <code>null</code> — MeshCentral не создал обработчик.
2. Убедитесь, что блок находится внутри <code>settings</code>:

~~~json
{
  "settings": {
    "plugins": { "enabled": true }
  }
}
~~~

3. Проверьте, что редактируется тот конфиг, который читает MeshCentral (<code>--configfile</code>, systemd или Docker mount).
4. Проверьте JSON: <code>jq . config.json</code>.
5. Полностью перезапустите MeshCentral.

### Плагин не загружается

Ищите в логе <code>Error loading plugin: ipgeo</code>. Проверьте:

~~~text
plugins/ipgeo/config.json
plugins/ipgeo/ipgeo.js
plugins/ipgeo/flags/
~~~

Имя папки должно быть ровно <code>ipgeo</code>.

### Нет флагов

- Убедитесь, что у устройства публичный IP, а не локальный.
- Проверьте наличие <code>flags/</code> и SVG-файлов.
- В network браузера проверьте запрос <code>/plugin/ipgeo/flags/&lt;cc&gt;.svg</code>.
- Очистите кэш браузера через <code>Ctrl+F5</code>.

### Не появляется подсказка

- Убедитесь, что установлена версия 1.3.0 или новее.
- В консоли проверьте <code>typeof pluginHandler.ipgeo.webShowTip</code> — должно быть <code>"function"</code>.
- Проверьте <code>document.querySelector('.ipgeo-b')?.getAttribute('data-tip')</code> — там должен быть провайдер.
- Если атрибут пустой, проверьте <code>cache.json</code> и лог MeshCentral.

### Слишком много запросов или HTTP 429

Оставьте стандартные значения batch и кэша. Не уменьшайте <code>batchIntervalMs</code> и <code>minIntervalMs</code> ниже лимитов провайдера.

## Удаление

1. Уберите <code>"ipgeo"</code> из <code>plugins.list</code> или удалите плагин в <code>My Server → Plugins</code>.
2. Удалите <code>&lt;meshcentral-data&gt;/plugins/ipgeo</code>.
3. Перезапустите MeshCentral.

## Приватность и безопасность

- Плагин отправляет публичные IP-адреса в выбранный GeoIP-сервис.
- Флаги отдаются локально самим MeshCentral.
- Плагины исполняются в процессе MeshCentral с полными правами сервера. Устанавливайте только доверенный код.
- Перед установкой на продакшн-сервер просмотрите исходники.
