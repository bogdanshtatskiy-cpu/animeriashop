# Animeria

Telegram Mini App украинской мастерской 3D-печати. Витрина коллекционных палочек с ручной покраской, реквизита и аксессуаров. React и Vite обслуживают интерфейс, Vercel запускает Node.js API, Firebase хранит каталог, черновики, заказы и фотографии.

## Запуск

Нужен Node.js 24. Скопируйте .env.example в .env и заполните публичную конфигурацию Firebase.

~~~sh
npm ci
npm run dev
npm run build
npm run lint
npm test
~~~

Vite показывает витрину и корзину в браузере. Для покупки нужен Telegram Mini App и серверные функции. Существующий каталог загружается из указанного проекта Firebase. Черновики палочек можно создать через шаблоны в /admin. Для публикации нужны цена и настоящее фото товара. Технология, материал, размеры, отделка, остаток и варианты задаются отдельно для каждого изделия.

Интерфейс на украинском. Изображение public/media/atelier.webp используется как обложка коллекции. Фото товаров берутся из каталога Firebase.

## Проверка полного сценария

Тесты используют демопроект, Firestore и Auth Emulator. Telegram и Новая почта подменяются только внутри тестового процесса. Для тестов нужен JDK 17 или новее.

~~~sh
npx playwright install chromium webkit
npm exec --yes --package firebase-tools@14.27.0 -- firebase emulators:exec --only firestore,auth --project demo-animeria "npm run test:e2e"
~~~

В сценарии проверяются мобильная витрина, избранное, вариант товара, доставка, промокод, повтор запроса, списание остатков и история заказов. Администратор может изменить статус, добавить ТТН и повторить неудачное сообщение. При отмене до отправки остаток возвращается.

## Публикация

Схема GitHub → Vercel сохраняет текущий URL приложения и интеграции. Для первой проверки выпустите Vercel Preview с отдельным демопроектом Firebase и тестовым ботом. Для перехода действующего магазина используйте текущий Vercel-проект и текущий проект Firebase. [Vercel для GitHub](https://vercel.com/docs/git/vercel-for-github)

1. Заполните VITE_FIREBASE_* и серверные переменные из .env.example в настройках проекта Vercel. Сервер использует Firebase Admin SDK через Application Default Credentials или FIREBASE_SERVICE_ACCOUNT_JSON. Сервисной учётной записи нужны права Firestore на чтение и запись и право Firebase Auth на чтение пользователей. В VITE_TELEGRAM_BOT_USERNAME сохраните имя бота без @ для ссылок на магазин и товары. VITE_ADMIN_TELEGRAM_ID управляет видимостью ссылки в профиле. Право администратора проверяется по существующему Firebase UID в правилах и API.
2. Загрузите новый составной индекс и дождитесь его готовности. Сохраните дополнительные индексы вашего проекта, если Firebase CLI предложит их удалить.

   ~~~sh
   npm exec --yes --package firebase-tools@14.27.0 -- firebase deploy --only firestore:indexes --project YOUR_FIREBASE_PROJECT
   ~~~

3. Проверьте Preview и опубликуйте релиз на текущем URL. Затем примените ограничения Firestore и Storage к тому же проекту. Старые открытые сессии Telegram следует перезапустить после переключения. Правила закрывают прямую запись заказов и публичный доступ к промокодам и избранному. [Firebase Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

   ~~~sh
   npm exec --yes --package firebase-tools@14.27.0 -- firebase deploy --only firestore:rules,storage --project YOUR_FIREBASE_PROJECT
   ~~~

4. Установите случайный TELEGRAM_WEBHOOK_SECRET в Vercel. Зарегистрируйте тот же секрет у Telegram после выкладки новой функции. Откройте личный чат с ботом под аккаунтом администратора, чтобы бот мог присылать уведомления. Для публикации отзывов бот должен иметь право писать в настроенный REVIEWS_CHANNEL_ID. [Telegram Bot API](https://core.telegram.org/bots/api#setwebhook)

   ~~~sh
   node --env-file=.env scripts/telegram-status.mjs --configure-webhook
   node --env-file=.env scripts/telegram-status.mjs
   ~~~

   SHOP_URL по умолчанию указывает на боевой адрес Animeria. Для тестового бота задайте SHOP_URL тестового приложения. Скрипт проверяет getMe, getWebhookInfo и доступ бота к чату администратора. Если Telegram отклонит отправку реального уведомления, код и описание ошибки сохраняются в карточке заказа в админке.

5. В Telegram оформите тестовый заказ. Проверьте историю покупателя, сообщение администратору, статусы, ТТН и команду /review после завершения. Заказ фиксирует товар, цену и доставку. Детали оплаты согласуются через Telegram, доставка рассчитывается по тарифу Новой почты.

Серверные переменные и приватные ключи храните в Vercel или локальном исключённом .env. Изменение VITE_* требует новой сборки.
