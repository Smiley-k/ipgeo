[English](README.md) | **Русский**
# MeshCentral IP Geo

Плагин для MeshCentral: показывает **локальный флаг страны** рядом с публичным IP устройства, а **провайдера, страну, ASN и IP** — в мгновенной подсказке при наведении.

## Возможности

- Локальные SVG-флаги ISO 3166-1 alpha-2, без внешних запросов за иконками.
- Мгновенная своя подсказка: провайдер, страна, ASN, IP.
- Batch-предзагрузка видимых строк через ip-api.com/batch (до 100 IP за запрос, 15 запросов/мин).
- Строки за пределами экрана подгружаются при прокрутке, изменении размера окна или возврате на вкладку.
- Серверный кэш на 7 дней (<code>cache.json</code>).
- Локальные адреса пропускаются: RFC1918, CGNAT, loopback, link-local, IPv6 ULA.
- Работает при размещении MeshCentral в корне и в подкаталоге (<code>/meshcentral/</code>).
- Fallback-провайдеры: ipwho.is и ipinfo.io.

## Как выглядит

В списке устройств:

~~~text
WAN 203.0.113.45 [флаг]
~~~

При наведении:

~~~text
Deutsche Telekom AG
Germany
AS3320 Deutsche Telekom AG
IP: 203.0.113.45
~~~

## Требования

- MeshCentral 1.1.0 или новее.
- Включённые плагины MeshCentral.
- Исходящий HTTP/HTTPS с сервера MeshCentral к <code>ip-api.com</code> (и fallback-сервисам).
- Для установки через веб-интерфейс — полный администратор сайта.

## Установка

Подробные инструкции:

- [INSTALL.ru.md](INSTALL.ru.md) — русский
- [INSTALL.en.md](INSTALL.en.md) — English

Кратко, вручную:

1. Скопировать папку <code>ipgeo</code> в <code>&lt;meshcentral-data&gt;/plugins/ipgeo</code>.
2. В <code>&lt;meshcentral-data&gt;/config.json</code> добавить загрузчик внутрь <code>settings</code>:

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

3. Перезапустить MeshCentral и обновить страницу с Ctrl+F5.

Блок <code>plugins</code> должен быть внутри <code>settings</code>, а не в корне <code>config.json</code>.

## Настройки

Скопировать <code>settings.example.json</code> в <code>settings.json</code> рядом с <code>ipgeo.js</code>.

| Параметр | По умолчанию | Описание |
|---|---:|---|
| provider | auto | auto, ip-api, ipwho или ipinfo |
| cacheHours | 168 | Время жизни кэша в часах |
| requestTimeoutMs | 5000 | Таймаут одного запроса |
| minIntervalMs | 1400 | Интервал между одиночными запросами |
| batchIntervalMs | 4200 | Интервал между batch-запросами |
| batchSize | 100 | IP в одном batch-запросе ip-api |
| batchMax | 200 | Максимум IP в batch от браузера |
| batchTimeoutMs | 15000 | Таймаут batch-запроса |
| debug | false | Отладочные сообщения в лог MeshCentral |

## Приватность

Наружу отправляются только публичные IP-адреса на выбранный GeoIP-сервис. Флаги отдаются локально самим MeshCentral. Если отправка IP на сторонний сервис неприемлема — плагин лучше не устанавливать.

## Ограничения

- GeoIP может ошибаться для VPN, мобильных операторов и anycast-адресов.
- Логотипы провайдеров не входят в плагин: флаг означает страну, а не бренд оператора.
- IPv6-адрес с портом в <code>lastaddr</code> разбирается эвристически.
- Плагин не поддерживается разработчиками ядра MeshCentral.

## Лицензия

Флаги: [flag-icons](https://github.com/lipis/flag-icons), MIT. См. <code>flags/LICENSE</code>.
