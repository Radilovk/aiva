/**
 * Идентичност и автентикация към KASY API.
 *
 * Досега клиентът сам си измисляше `user_id` и го пращаше в тялото на всяка заявка —
 * сървърът го приемаше на доверие. Сега идентичността се потвърждава от сървъра и всяка
 * заявка носи таен токен в `Authorization: Bearer`.
 *
 * Потребителят не вижда нищо: няма екран за вход, няма парола. Регистрацията се случва
 * тихо при първата API заявка.
 *
 * Файлът се зарежда веднага след config.js и подменя `window.fetch`, така че всички
 * съществуващи извиквания получават хедъра, без да се пипат едно по едно. Прихващат се
 * само заявки към нашето API — заявките към Gemini, Stripe и всичко останало минават
 * непроменени, за да не изтече токенът навън.
 *
 * @see docs/LAUNCH-PLAN.md — Фаза 0
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'aiva_app_token';
  const USER_KEY = 'aiva_user_id';

  const nativeFetch = window.fetch.bind(window);

  function apiBase() {
    // config.js вече е зареден, но пазим се от промяна на реда на скриптовете.
    return window.AIVA_CONFIG?.API_BASE ?? '';
  }

  /** Вярно само за нашето API — токенът не бива да пътува към чужди хостове. */
  function isApiRequest(rawUrl) {
    let target;
    try {
      target = new URL(rawUrl, location.href);
    } catch {
      return false;
    }
    if (!target.pathname.startsWith('/api/')) return false;

    const base = apiBase();
    const expected = base ? new URL(base, location.href).origin : location.origin;
    return target.origin === expected;
  }

  function storedToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function persist(userId, token) {
    try {
      localStorage.setItem(USER_KEY, userId);
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* частен режим — токенът живее само за тази сесия */
    }
  }

  /** Идентификаторът, който приложението вече ползва; създава се, ако още го няма. */
  function localUserId() {
    let id = null;
    try {
      id = localStorage.getItem(USER_KEY);
    } catch {
      /* без localStorage работим в паметта */
    }
    if (!id) {
      id = 'user_' + crypto.randomUUID();
      try {
        localStorage.setItem(USER_KEY, id);
      } catch {
        /* пак нищо — сървърът ще върне идентичност за тази сесия */
      }
    }
    return id;
  }

  let inFlight = null;
  let memoryToken = null;

  /**
   * Иска идентичност от сървъра.
   *
   * Заварените потребители имат `user_id` в localStorage и задачи в базата, но никога не са
   * били регистрирани. Затова пращаме текущия идентификатор като `claim_user_id` — сървърът
   * го осиновява, ако е свободен, и задачите се запазват. Ако е зает, връща нова идентичност
   * и я записваме.
   */
  async function register() {
    const claim = localUserId();

    const res = await nativeFetch(`${apiBase()}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_user_id: claim }),
    });

    if (!res.ok) {
      throw new Error(`Регистрацията не успя (${res.status})`);
    }

    const data = await res.json();
    if (!data?.app_token || !data?.user_id) {
      throw new Error('Сървърът не върна идентичност');
    }

    memoryToken = data.app_token;
    persist(data.user_id, data.app_token);
    return data.app_token;
  }

  async function ensureToken() {
    const existing = storedToken() || memoryToken;
    if (existing) return existing;

    // Паралелните заявки при старт трябва да чакат една регистрация, не всяка своя.
    if (!inFlight) {
      inFlight = register().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  /** Изхвърля токена — при 401 следващата заявка се регистрира наново. */
  function forget() {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* няма какво да чистим */
    }
  }

  async function authorizedRequest(input, init, token) {
    const request = new Request(input, init);
    request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  }

  window.fetch = async function patchedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;

    if (!isApiRequest(url)) {
      return nativeFetch(input, init);
    }

    const token = await ensureToken();
    const request = await authorizedRequest(input, init, token);

    // Тялото се чете веднъж — пазим копие за евентуалния втори опит.
    const retryable = request.clone();
    const response = await nativeFetch(request);

    // Токенът може да е бил отменен (изчистена база, ротация). Регистрираме се наново
    // веднъж, вместо да оставим приложението мъртво до ръчно изчистване на данните.
    if (response.status === 401) {
      forget();
      const fresh = await ensureToken();
      const secondTry = await authorizedRequest(retryable, undefined, fresh);
      return nativeFetch(secondTry);
    }

    return response;
  };

  window.AIVA_AUTH = {
    ensureToken,
    forget,
    getUserId: localUserId,
  };
})();
