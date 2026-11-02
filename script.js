(async () => {
    const settingsKey = "queue-site-settings";
    const editsKey = "queue-visual-edits";
    const adminSessionKey = "queue-admin-token";
    const defaults = {
        brand: "Qúeue",
        title: "Место, где море ближе.",
        subtitle: "Тёплый свет, неспешный кофе и горизонт, который хочется рассматривать чуть дольше.",
        address: "Набережная ул., 13, Анапа",
        hours: "08:00–22:00",
        phone: "+7 (918) 054-33-49"
    };

    const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);

    const readStorage = (key, fallback) => {
        try {
            const value = window.localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch (error) {
            console.error(`Не удалось прочитать данные сайта (${key}).`, error);
            return fallback;
        }
    };

    const writeStorage = (key, value) => {
        window.localStorage.setItem(key, JSON.stringify(value));
    };

    const applySettings = (settings) => {
        document.querySelectorAll("[data-brand]").forEach((element) => {
            element.innerHTML = `${escapeHtml(settings.brand)}<span class="wordmark-dot">.</span>`;
        });
        document.querySelectorAll("[data-title]").forEach((element) => {
            const words = settings.title.split(/\s+/);
            const lineBreak = Math.max(1, Math.ceil(words.length / 2));
            const firstLine = words.slice(0, lineBreak).join(" ");
            const secondLine = words.slice(lineBreak).join(" ");
            element.innerHTML = `${escapeHtml(firstLine)}<br><em>${escapeHtml(secondLine)}</em>`;
        });
        document.querySelectorAll("[data-subtitle]").forEach((element) => {
            element.textContent = settings.subtitle;
        });
        document.querySelectorAll("[data-address]").forEach((element) => {
            if (element.tagName === "P") {
                element.innerHTML = escapeHtml(settings.address).replace(/,\s*/, "<br>");
            } else {
                element.textContent = settings.address;
            }
        });
        document.querySelectorAll("[data-hours]").forEach((element) => {
            element.textContent = settings.hours;
        });
        document.querySelectorAll("[data-phone]").forEach((element) => {
            element.textContent = settings.phone;
        });
        document.querySelectorAll("[data-phone-link]").forEach((element) => {
            element.href = `tel:${settings.phone.replace(/[^\d+]/g, "")}`;
        });
    };

    const settings = { ...defaults, ...readStorage(settingsKey, {}) };
    applySettings(settings);

    const url = new URL(window.location.href);
    const isAdmin = url.searchParams.get("admin") === "1";
    if (!isAdmin) return;

    const apiBase = (window.QUEUE_AUTH_API || "").trim().replace(/\/+$/, "");
    let adminToken = sessionStorage.getItem(adminSessionKey) || "";
    const authDialog = document.createElement("dialog");
    authDialog.className = "admin-auth-dialog";
    authDialog.innerHTML = `
        <form class="admin-auth-form">
            <p class="eyebrow"><span class="eyebrow-line"></span> QÚEUE · АДМИНИСТРАТОР</p>
            <h1 class="admin-auth-title">Вход в редактор</h1>
            <p class="admin-auth-description">Введите пароль, чтобы продолжить редактирование сайта.</p>
            <label class="admin-auth-label" for="admin-setup-key" hidden>Ключ первичной настройки Cloudflare</label>
            <input class="admin-auth-input" id="admin-setup-key" type="password" autocomplete="off" hidden>
            <label class="admin-auth-label" for="admin-password">Пароль</label>
            <input class="admin-auth-input" id="admin-password" type="password" autocomplete="current-password" required>
            <label class="admin-auth-label" for="admin-password-confirm" hidden>Повторите новый пароль</label>
            <input class="admin-auth-input" id="admin-password-confirm" type="password" autocomplete="new-password" minlength="12" hidden>
            <p class="admin-auth-status" role="status" aria-live="polite"></p>
            <button class="button-link" type="submit">Войти</button>
        </form>`;
    document.body.append(authDialog);
    const authForm = authDialog.querySelector(".admin-auth-form");
    const authStatus = authDialog.querySelector(".admin-auth-status");
    const authSubmit = authForm.querySelector('button[type="submit"]');
    const setupKeyInput = authDialog.querySelector("#admin-setup-key");
    const passwordInput = authDialog.querySelector("#admin-password");
    const confirmInput = authDialog.querySelector("#admin-password-confirm");
    const setAuthMode = (setup) => {
        authDialog.querySelector(".admin-auth-title").textContent = setup ? "Настроить вход" : "Вход в редактор";
        authDialog.querySelector(".admin-auth-description").textContent = setup
            ? "Введите ключ настройки из Cloudflare и создайте пароль администратора."
            : "Введите пароль, чтобы продолжить редактирование сайта.";
        authDialog.querySelector('label[for="admin-setup-key"]').hidden = !setup;
        setupKeyInput.hidden = !setup;
        setupKeyInput.required = setup;
        authDialog.querySelector('label[for="admin-password"]').textContent = setup
            ? "Новый пароль (не менее 12 символов)"
            : "Пароль";
        passwordInput.autocomplete = setup ? "new-password" : "current-password";
        passwordInput.minLength = setup ? 12 : 1;
        authDialog.querySelector('label[for="admin-password-confirm"]').hidden = !setup;
        confirmInput.hidden = !setup;
        confirmInput.required = setup;
        authSubmit.textContent = setup ? "Создать пароль" : "Войти";
    };
    const requestAuth = async (path, { method = "GET", token = "", body } = {}) => {
        const headers = {};
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${apiBase}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            mode: "cors",
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer"
        });
        const result = await response.json();
        if (!response.ok) {
            const error = new Error(result.error || "request_failed");
            error.status = response.status;
            throw error;
        }
        return result;
    };
    const authErrorMessage = (error) => {
        if (error.status === 401 && error.message === "invalid_credentials") return "Неверный пароль.";
        if (error.status === 403 && error.message === "setup_not_authorized") return "Неверный ключ первичной настройки Cloudflare.";
        if (error.message === "origin_not_allowed") return "Адрес сайта ещё не разрешён в настройках Cloudflare Worker.";
        if (error.status === 401 || error.status === 403) return "Не удалось подтвердить доступ. Проверьте пароль и настройки Worker.";
        if (error.status === 409 && error.message === "already_configured") return "Пароль уже создан. Обновите страницу и войдите с ним.";
        if (error.status === 409 && error.message === "setup_required") return "Сначала создайте пароль администратора.";
        if (error.status === 429) return "Слишком много попыток. Подождите 15 минут и попробуйте снова.";
        if (error.status === 400 && error.message === "weak_password") return "Пароль должен содержать не менее 12 символов.";
        if (error.message === "Failed to fetch") return "Нет связи с сервером авторизации. Проверьте URL Worker и подключение к интернету.";
        return "Не удалось выполнить запрос авторизации. Проверьте настройки сервера и попробуйте снова.";
    };

    if (!apiBase || !/^https:\/\/[^/]+$/i.test(apiBase)) {
        setAuthMode(false);
        authDialog.querySelector(".admin-auth-title").textContent = "Сервер не настроен";
        authDialog.querySelector(".admin-auth-description").textContent =
            "Укажите HTTPS-адрес Cloudflare Worker в файле auth-config.js.";
        authForm.querySelectorAll("label, input").forEach((element) => { element.hidden = true; });
        authStatus.textContent = "Редактор заблокирован, пока сервер авторизации не подключён.";
        authSubmit.disabled = true;
        authDialog.showModal();
        return;
    }

    authDialog.showModal();
    authSubmit.disabled = true;
    let setupRequired = false;
    try {
        const status = await requestAuth("/auth/status");
        setupRequired = !status.configured;
        if (setupRequired && adminToken) {
            sessionStorage.removeItem(adminSessionKey);
            adminToken = "";
        }
        if (!setupRequired && adminToken) {
            try {
                await requestAuth("/auth/session", { token: adminToken });
                authDialog.close();
                authDialog.remove();
            } catch {
                sessionStorage.removeItem(adminSessionKey);
                adminToken = "";
            }
        }
        if (setupRequired || !adminToken) {
            setAuthMode(setupRequired);
            authSubmit.disabled = false;
            passwordInput.focus();
        }
    } catch (error) {
        authStatus.textContent = authErrorMessage(error);
        authSubmit.disabled = true;
    }

    if (!adminToken && authDialog.open) {
        authForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            authStatus.dataset.success = "false";
            authStatus.textContent = "";
            authSubmit.disabled = true;
            try {
                if (setupRequired && passwordInput.value !== confirmInput.value) {
                    authStatus.textContent = "Пароли не совпадают.";
                    confirmInput.select();
                    return;
                }
                const result = await requestAuth(setupRequired ? "/auth/setup" : "/auth/login", {
                    method: "POST",
                    body: setupRequired
                        ? { setupKey: setupKeyInput.value, password: passwordInput.value }
                        : { password: passwordInput.value }
                });
                adminToken = result.token;
                sessionStorage.setItem(adminSessionKey, adminToken);
                window.location.reload();
            } catch (error) {
                authStatus.textContent = authErrorMessage(error);
                if (error.status === 409 && error.message === "already_configured") {
                    setupRequired = false;
                    setAuthMode(false);
                }
                if (error.status !== 429) authSubmit.disabled = false;
            }
        });
    }
    if (!adminToken || authDialog.open) return;

    document.body.classList.add("admin-edit-mode");
    const sessionCheck = window.setInterval(async () => {
        try {
            await requestAuth("/auth/session", { token: adminToken });
        } catch (error) {
            if (error.status === 401) {
                sessionStorage.removeItem(adminSessionKey);
                window.location.reload();
                return;
            }
            console.error("Не удалось проверить сессию администратора.", error);
        }
    }, 60 * 1000);
    window.addEventListener("pagehide", () => window.clearInterval(sessionCheck), { once: true });

    const pageName = location.pathname.toLowerCase().endsWith("menu.html") ? "menu" : "home";
    const edits = readStorage(editsKey, {});

    const setElementText = (element, value) => {
        const sizePrices = [...element.querySelectorAll(":scope > .menu-size-price")];
        if (sizePrices.length === 2) {
            const values = value.split(/\s*\/\s*/);
            if (values.length === 2) {
                sizePrices.forEach((price, index) => {
                    price.textContent = values[index];
                });
            } else {
                const availablePrices = sizePrices.filter((price) => price.textContent.trim() !== "—");
                (availablePrices.length === 1 ? availablePrices : [sizePrices[0]])[0].textContent = value;
            }
            return;
        }
        const emphasized = element.querySelector(":scope > em, :scope > strong");
        const lineBreak = element.querySelector(":scope > br");
        const button = element.querySelector(":scope > .admin-edit-trigger");
        const buttonParent = button?.parentElement;
        if (button) button.remove();
        if (emphasized) {
            const lines = value.trim().split(/\r?\n/);
            const firstText = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
            if (lineBreak) {
                if (firstText) firstText.textContent = lines.shift() || "";
                emphasized.textContent = lines.join(" ");
            } else {
                const words = value.trim().split(/\s+/);
                if (firstText) firstText.textContent = words.shift() || "";
                emphasized.textContent = words.length ? ` ${words.join(" ")}` : "";
            }
            if (button) buttonParent.append(button);
            return;
        }

        const decorations = [...element.children].filter((child) =>
            child.matches(".wordmark-dot, .eyebrow-line, [aria-hidden='true']")
        );
        const textNode = document.createTextNode(
            element.classList.contains("wordmark") ? value.replace(/\.$/, "") : value
        );
        const trailingNodes = button ? [button] : [];
        const leadingNodes = element.classList.contains("eyebrow") ? decorations : [];
        const endingNodes = element.classList.contains("eyebrow") ? [] : decorations;
        element.replaceChildren(...leadingNodes, textNode, ...endingNodes, ...trailingNodes);
    };

    const getElementText = (element) => {
        const sizePrices = [...element.querySelectorAll(":scope > .menu-size-price")];
        if (sizePrices.length === 2) {
            return sizePrices.map((price) => price.textContent.trim()).join(" / ");
        }
        const clone = element.cloneNode(true);
        clone.querySelectorAll(".admin-edit-trigger, .wordmark-dot, .eyebrow-line, [aria-hidden='true']").forEach((node) => node.remove());
        clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
        return clone.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
    };

    const applyElementEdit = (element, edit) => {
        if (typeof edit.text === "string") setElementText(element, edit.text);
        if (element instanceof HTMLAnchorElement && typeof edit.href === "string") {
            element.href = edit.href;
        }
        if (element instanceof HTMLImageElement && typeof edit.src === "string") {
            element.src = edit.src;
        }
        if (element.classList.contains("hero") && typeof edit.src === "string") {
            element.style.setProperty("--wall-image", `url("${edit.src}")`);
        }
    };

    const textSelectors = [
        ".wordmark",
        ".main-nav a",
        ".header-cta",
        ".eyebrow",
        "h1",
        "h2",
        "h3",
        ".hero-description",
        ".text-link",
        ".hero-note > span:last-child",
        ".hero-bottom > span:not(.bottom-rule)",
        ".intro-copy > p",
        ".signature",
        ".art-caption",
        "figcaption",
        ".button-link",
        ".instagram-link",
        ".visit-invitation",
        ".detail-label",
        ".detail-block > p",
        ".detail-block > a",
        ".menu-jump a",
        ".menu-item > span:first-child",
        ".menu-price",
        ".menu-subheading",
        ".menu-intro",
        ".menu-hero-row > p",
        ".menu-size-heading:not(.menu-size-heading-secondary) > span:not(:empty)",
        ".menu-visit-details > p",
        ".menu-visit-details > a:not(.button-link)",
        ".footer-contact > span",
        ".footer-contact > a",
        ".site-footer > p",
        ".footer-copy",
        ".back-top"
    ];

    const imageSelectors = [
        ".hero-art img",
        ".photo-tile img",
        ".menu-photo img",
        ".original-menu img"
    ];

    const targets = new Map();
    const registerTargets = (selectors, type) => {
        let index = 0;
        selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((element) => {
                if (element.closest(".admin-edit-toolbar, .admin-edit-dialog")) return;
                const key = `${pageName}:${type}:${index++}`;
                const saved = edits[key];
                element.dataset.editKey = key;
                if (saved) applyElementEdit(element, saved);
                targets.set(key, { element, type });
            });
        });
    };
    registerTargets(textSelectors, "text");
    registerTargets(imageSelectors, "image");
    if (pageName === "home") {
        const hero = document.querySelector(".hero");
        if (hero) {
            const key = "home:wall-image:0";
            hero.dataset.editKey = key;
            if (edits[key]) applyElementEdit(hero, edits[key]);
            targets.set(key, { element: hero, type: "image" });
        }
    }

    const toolbar = document.createElement("aside");
    toolbar.className = "admin-edit-toolbar";
    toolbar.innerHTML = `
        <span class="admin-toolbar-status"><span class="admin-toolbar-dot"></span> РЕЖИМ РЕДАКТИРОВАНИЯ</span>
        <span class="admin-toolbar-hint">Нажмите на карандаш у элемента</span>
        <button class="admin-toolbar-preview" type="button">Предпросмотр</button>
        <button class="admin-toolbar-password" type="button">Сменить пароль</button>
        <button class="admin-toolbar-exit" type="button">Готово</button>`;
    document.body.append(toolbar);

    const passwordDialog = document.createElement("dialog");
    passwordDialog.className = "admin-auth-dialog admin-password-dialog";
    passwordDialog.innerHTML = `
        <form class="admin-auth-form">
            <button class="admin-dialog-close" type="button" aria-label="Закрыть">×</button>
            <p class="eyebrow"><span class="eyebrow-line"></span> НАСТРОЙКИ ДОСТУПА</p>
            <h2 class="admin-auth-title">Сменить пароль</h2>
            <label class="admin-auth-label" for="admin-current-password">Предыдущий пароль</label>
            <input class="admin-auth-input" id="admin-current-password" type="password" autocomplete="current-password" required>
            <label class="admin-auth-label" for="admin-new-password">Новый пароль (не менее 12 символов)</label>
            <input class="admin-auth-input" id="admin-new-password" type="password" autocomplete="new-password" minlength="12" required>
            <label class="admin-auth-label" for="admin-new-password-confirm">Подтвердите новый пароль</label>
            <input class="admin-auth-input" id="admin-new-password-confirm" type="password" autocomplete="new-password" minlength="12" required>
            <p class="admin-auth-status" role="status" aria-live="polite"></p>
            <button class="button-link" type="submit">Сохранить пароль</button>
        </form>`;
    document.body.append(passwordDialog);
    const passwordForm = passwordDialog.querySelector(".admin-auth-form");
    const passwordStatus = passwordDialog.querySelector(".admin-auth-status");
    toolbar.querySelector(".admin-toolbar-password").addEventListener("click", () => {
        passwordForm.reset();
        passwordStatus.textContent = "";
        passwordStatus.dataset.success = "false";
        passwordDialog.showModal();
        passwordDialog.querySelector("#admin-current-password").focus();
    });
    passwordDialog.querySelector(".admin-dialog-close").addEventListener("click", () => passwordDialog.close());
    passwordDialog.addEventListener("click", (event) => {
        if (event.target === passwordDialog) passwordDialog.close();
    });
    passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        passwordStatus.dataset.success = "false";
        passwordStatus.textContent = "";
        const currentPassword = passwordDialog.querySelector("#admin-current-password").value;
        const newPassword = passwordDialog.querySelector("#admin-new-password").value;
        const confirmation = passwordDialog.querySelector("#admin-new-password-confirm").value;
        try {
            if (newPassword.length < 12) {
                passwordStatus.textContent = "Новый пароль должен содержать не менее 12 символов.";
                return;
            }
            if (newPassword !== confirmation) {
                passwordStatus.textContent = "Новые пароли не совпадают.";
                return;
            }
            const result = await requestAuth("/auth/change-password", {
                method: "POST",
                token: adminToken,
                body: { currentPassword, newPassword }
            });
            adminToken = result.token;
            sessionStorage.setItem(adminSessionKey, adminToken);
            passwordForm.reset();
            passwordStatus.dataset.success = "true";
            passwordStatus.textContent = "Пароль изменён.";
        } catch (error) {
            console.error("Не удалось сменить пароль администратора.", error);
            passwordStatus.textContent = authErrorMessage(error);
        }
    });

    const dialog = document.createElement("dialog");
    dialog.className = "admin-edit-dialog";
    dialog.innerHTML = `
        <form class="admin-edit-form">
            <button class="admin-dialog-close" type="button" aria-label="Закрыть">×</button>
            <p class="eyebrow"><span class="eyebrow-line"></span> РЕДАКТИРОВАНИЕ САЙТА</p>
            <h2 class="admin-dialog-title">Изменить элемент</h2>
            <label class="admin-dialog-label" for="edit-text">Текст</label>
            <textarea id="edit-text" class="admin-dialog-input" rows="3"></textarea>
            <label class="admin-dialog-label" for="edit-href">Куда ведёт ссылка</label>
            <input id="edit-href" class="admin-dialog-input" type="text" placeholder="https://... или #раздел">
            <label class="admin-dialog-label admin-file-label" for="edit-image">Заменить фотографию</label>
            <input id="edit-image" class="admin-dialog-file" type="file" accept="image/*">
            <p class="admin-dialog-note">Изменения сохраняются в этом браузере и сразу видны на обычной версии сайта.</p>
            <p class="admin-dialog-status" role="status" aria-live="polite"></p>
            <div class="admin-dialog-actions">
                <button class="admin-dialog-reset" type="button">Сбросить элемент</button>
                <button class="button-link" type="submit">Сохранить <span class="arrow-icon" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 9.5 9.25 2.75M3.5 2.75h5.75V8.5"/></svg></span></button>
            </div>
        </form>`;
    document.body.append(dialog);

    const form = dialog.querySelector(".admin-edit-form");
    const textField = dialog.querySelector("#edit-text");
    const hrefField = dialog.querySelector("#edit-href");
    const imageField = dialog.querySelector("#edit-image");
    const hrefLabel = dialog.querySelector('label[for="edit-href"]');
    const imageLabel = dialog.querySelector(".admin-file-label");
    const status = dialog.querySelector(".admin-dialog-status");
    let activeKey = "";
    let activeTarget = null;

    const openEditor = (key) => {
        const target = targets.get(key);
        if (!target) return;
        activeKey = key;
        activeTarget = target;
        const saved = edits[key] || {};
        const element = target.element;
        const link = element instanceof HTMLAnchorElement ? element : element.closest("a");
        const isImage = target.type === "image";
        const canEditText = target.type === "text";
        dialog.querySelector(".admin-dialog-title").textContent =
            isImage ? "Заменить фотографию" : link ? "Изменить текст или ссылку" : "Изменить текст";
        dialog.querySelector('label[for="edit-text"]').hidden = !canEditText;
        textField.hidden = !canEditText;
        textField.value = saved.text ?? getElementText(element);
        hrefLabel.hidden = !link;
        hrefField.hidden = !link;
        hrefField.value = saved.href ?? link?.href ?? "";
        imageLabel.hidden = !isImage;
        imageField.hidden = !isImage;
        imageField.value = "";
        status.textContent = "";
        dialog.showModal();
        if (canEditText) textField.focus();
        else if (isImage) imageField.focus();
    };

    const addEditButton = (element, key, image = false) => {
        const holder = image && !element.classList.contains("hero") ? element.parentElement : element;
        if (!holder || holder.querySelector(`:scope > .admin-edit-trigger[data-target="${key}"]`)) return;
        holder.classList.add("admin-editable");
        const button = document.createElement("button");
        button.type = "button";
        const link = element instanceof HTMLAnchorElement ? element : element.closest("a");
        button.className = `admin-edit-trigger${image ? " admin-edit-image-trigger" : link ? " admin-edit-link-trigger" : " admin-edit-text-trigger"}`;
        button.dataset.target = key;
        button.setAttribute("aria-label", image ? "Заменить фотографию" : "Изменить этот элемент");
        button.title = "Изменить";
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>';
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openEditor(key);
        });
        holder.append(button);
        if (!link && !image) {
            element.addEventListener("click", () => {
                if (window.matchMedia("(max-width: 560px)").matches) openEditor(key);
            });
        }
    };

    targets.forEach(({ element, type }, key) => {
        addEditButton(element, key, type === "image");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeTarget) return;

        const nextEdit = { ...(edits[activeKey] || {}) };
        if (activeTarget.type === "text") nextEdit.text = textField.value.trim();
        const link = activeTarget.element instanceof HTMLAnchorElement
            ? activeTarget.element
            : activeTarget.element.closest("a");
        if (link && !hrefField.hidden) {
            const href = hrefField.value.trim();
            if (href && !isSafeHref(href)) {
                status.textContent = "Используйте обычную ссылку, телефон, почту или якорь раздела.";
                return;
            }
            nextEdit.href = href;
        }

        const file = imageField.files[0];
        if (file) {
            if (file.size > 15 * 1024 * 1024) {
                status.textContent = "Фото слишком большое. Выберите изображение до 15 МБ.";
                return;
            }
            try {
                nextEdit.src = await compressImage(file);
            } catch (error) {
                console.error("Не удалось подготовить выбранное фото.", error);
                status.textContent = "Не удалось открыть это изображение. Выберите другое фото.";
                return;
            }
        }

        try {
            edits[activeKey] = nextEdit;
            writeStorage(editsKey, edits);
            applyElementEdit(activeTarget.element, nextEdit);
            dialog.close();
        } catch (error) {
            console.error("Не удалось сохранить изменение в хранилище браузера.", error);
            status.textContent = "Не удалось сохранить. Возможно, в браузере закончилось место для фотографий.";
        }
    });

    dialog.querySelector(".admin-dialog-reset").addEventListener("click", () => {
        try {
            delete edits[activeKey];
            writeStorage(editsKey, edits);
            window.location.reload();
        } catch (error) {
            console.error("Не удалось сбросить изменение.", error);
            status.textContent = "Не удалось сбросить это изменение.";
        }
    });
    dialog.querySelector(".admin-dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });

    const preserveAdminMode = (anchor) => {
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("tel:") || href.startsWith("mailto:")) return;
        const destination = new URL(href, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (destination.pathname.endsWith("index.html") || destination.pathname.endsWith("menu.html")) {
            destination.searchParams.set("admin", "1");
            anchor.href = destination.href;
        }
    };
    document.querySelectorAll("a[href]").forEach(preserveAdminMode);
    const leaveEditor = async () => {
        try {
            await requestAuth("/auth/logout", { method: "POST", token: adminToken, body: {} });
        } catch (error) {
            console.error("Не удалось завершить сессию на сервере.", error);
            window.alert("Не удалось связаться с сервером для завершения сессии. Локальный вход будет удалён.");
        }
        sessionStorage.removeItem(adminSessionKey);
        url.searchParams.delete("admin");
        window.location.href = url.href;
    };
    toolbar.querySelector(".admin-toolbar-preview").addEventListener("click", leaveEditor);
    toolbar.querySelector(".admin-toolbar-exit").addEventListener("click", leaveEditor);

    async function compressImage(file) {
        const source = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(reader.result));
            reader.addEventListener("error", () => reject(reader.error));
            reader.readAsDataURL(file);
        });
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.addEventListener("load", () => resolve(element));
            element.addEventListener("error", () => reject(new Error("Unsupported image format")));
            element.src = source;
        });
        const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Image compression failed"));
                    return;
                }
                const reader = new FileReader();
                reader.addEventListener("load", () => resolve(reader.result));
                reader.addEventListener("error", () => reject(reader.error));
                reader.readAsDataURL(blob);
            }, "image/jpeg", 0.84);
        });
    }

    function isSafeHref(href) {
        if (href.startsWith("#")) return true;
        try {
            return ["http:", "https:", "tel:", "mailto:", "file:"].includes(new URL(href, window.location.href).protocol);
        } catch {
            return false;
        }
    }
})();
