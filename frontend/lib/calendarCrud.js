(function () {
  const LOCAL_CALENDAR_ID_KEY = 'kaya_local_calendar_id';
  const EVENT_MAP_KEY = 'kaya_local_calendar_event_map';

  function getPlatform() {
    return window.Capacitor?.getPlatform?.() || 'web';
  }

  function isAndroid() {
    return getPlatform() === 'android';
  }

  function getCalendarPlugin() {
    try {
      return window.Capacitor?.Plugins?.KayaCalendar ||
        window.Capacitor?.registerPlugin?.('KayaCalendar') ||
        null;
    } catch {
      return null;
    }
  }

  function getSelectedCalendarId() {
    return localStorage.getItem(LOCAL_CALENDAR_ID_KEY) || '';
  }

  function setSelectedCalendarId(calendarId) {
    if (!calendarId) {
      localStorage.removeItem(LOCAL_CALENDAR_ID_KEY);
      return;
    }
    localStorage.setItem(LOCAL_CALENDAR_ID_KEY, String(calendarId));
  }

  function loadEventMap() {
    try {
      return JSON.parse(localStorage.getItem(EVENT_MAP_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveEventMap(map) {
    localStorage.setItem(EVENT_MAP_KEY, JSON.stringify(map));
  }

  function hasLocalEvent(taskId) {
    if (!taskId) return false;
    return !!loadEventMap()[String(taskId)];
  }

  function getMappedEventId(taskId) {
    if (!taskId) return '';
    return loadEventMap()[String(taskId)]?.eventId || '';
  }

  function getLocalEventIds() {
    return new Set(Object.values(loadEventMap()).map((e) => String(e.eventId)).filter(Boolean));
  }

  function parseTaskDateTime(task) {
    const parsed = window.KAYA_ICS?.parseTaskDateTime?.(task);
    if (parsed?.start && parsed?.end) return parsed;
    if (!task?.due_date) return null;
    const startIso = `${task.due_date}T${task.due_time || '09:00'}:00`;
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) return null;
    const durationMs = Math.max(1, Number(task.estimated_minutes) || 30) * 60000;
    return { start, end: new Date(start.getTime() + durationMs) };
  }

  function normalizeCalendars(payload) {
    const source = payload?.calendars || payload?.result || payload || [];
    if (!Array.isArray(source)) return [];
    return source.map((cal, index) => ({
      id: String(cal.id ?? cal.calendarId ?? cal.name ?? index),
      name: String(cal.name ?? cal.title ?? cal.id ?? `Календар ${index + 1}`),
      isPrimary: cal.isPrimary === true,
      raw: cal,
    }));
  }

  async function requestPermissions() {
    if (!isAndroid()) return { granted: false, platform: getPlatform() };
    const calendar = getCalendarPlugin();
    if (!calendar?.requestPermissions) {
      throw new Error('KayaCalendar plugin не е наличен');
    }
    const result = await calendar.requestPermissions();
    const granted = result?.granted === true ||
      result?.publicStorage === 'granted' ||
      result?.calendar === 'granted' ||
      result?.readCalendar === 'granted' ||
      result?.writeCalendar === 'granted';
    return { granted, result, platform: getPlatform() };
  }

  async function getCalendars() {
    if (!isAndroid()) return [];
    const calendar = getCalendarPlugin();
    const reader = calendar?.getCalendars || calendar?.listCalendars;
    if (!reader) {
      throw new Error('KayaCalendar.getCalendars() не е наличен');
    }
    const result = await reader.call(calendar);
    return normalizeCalendars(result);
  }

  function buildAndroidPayload(task, calendarId) {
    const parsed = parseTaskDateTime(task);
    if (!parsed) throw new Error('Задачата няма валидна дата');
    return {
      calendarId,
      title: task.content || 'KAYA задача',
      description: task.notes || '',
      location: task.location || '',
      startDate: parsed.start.toISOString(),
      endDate: parsed.end.toISOString(),
      startTime: parsed.start.getTime(),
      endTime: parsed.end.getTime(),
      allDay: false,
    };
  }

  async function createKayaEvent(eventData, webOperation) {
    if (!isAndroid()) {
      if (typeof webOperation === 'function') return webOperation();
      return { branch: 'web', skipped: true };
    }
    const calendarId = getSelectedCalendarId();
    if (!calendarId) throw new Error('Липсва избран локален календар');
    const calendar = getCalendarPlugin();
    const createEvent = calendar?.createEvent || calendar?.addEvent;
    if (!createEvent) {
      throw new Error('KayaCalendar.createEvent() не е наличен');
    }
    const payload = buildAndroidPayload(eventData, calendarId);
    const result = await createEvent.call(calendar, payload);
    const eventId = String(result?.eventId || result?.id || '');
    if (eventId && eventData?.id) {
      const map = loadEventMap();
      map[String(eventData.id)] = { eventId, calendarId, syncedAt: Date.now() };
      saveEventMap(map);
    }
    return { branch: 'android', result };
  }

  async function updateKayaEvent(eventData, webOperation) {
    if (!isAndroid()) {
      if (typeof webOperation === 'function') return webOperation();
      return { branch: 'web', skipped: true };
    }
    const calendar = getCalendarPlugin();
    const eventId = getMappedEventId(eventData?.id);
    const updateEvent = calendar?.updateEvent || calendar?.editEvent;
    if (!eventId || !updateEvent) {
      return createKayaEvent(eventData, webOperation);
    }
    const payload = buildAndroidPayload(eventData, getSelectedCalendarId());
    const result = await updateEvent.call(calendar, { ...payload, eventId, id: eventId });
    return { branch: 'android', result };
  }

  async function deleteKayaEvent(taskId, webOperation) {
    if (!isAndroid()) {
      if (typeof webOperation === 'function') return webOperation();
      return { branch: 'web', skipped: true };
    }
    const eventId = getMappedEventId(taskId);
    const map = loadEventMap();
    const calendar = getCalendarPlugin();
    const removeEvent = calendar?.deleteEvent || calendar?.removeEvent;
    if (eventId && removeEvent) {
      await removeEvent.call(calendar, { eventId, id: eventId, calendarId: getSelectedCalendarId() });
    }
    delete map[String(taskId)];
    saveEventMap(map);
    return { branch: 'android', removed: true };
  }

  function parseEventDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function buildExternalEventPayload(fields = {}) {
    const start = parseEventDateTime(fields.startDate || fields.start);
    const end = parseEventDateTime(fields.endDate || fields.end);
    if (!start) throw new Error('Липсва валидна начална дата/час');
    const endDate = end && end > start ? end : new Date(start.getTime() + 30 * 60000);
    return {
      calendarId: getSelectedCalendarId(),
      title: fields.title || 'Събитие',
      description: fields.description || '',
      location: fields.location || '',
      startDate: start.toISOString(),
      endDate: endDate.toISOString(),
      startTime: start.getTime(),
      endTime: endDate.getTime(),
      allDay: false,
    };
  }

  async function updateExternalEvent(eventId, fields = {}, webOperation) {
    if (!eventId) throw new Error('Липсва eventId');
    if (!isAndroid()) {
      if (typeof webOperation === 'function') return webOperation();
      return { branch: 'web', skipped: true };
    }
    const calendar = getCalendarPlugin();
    const updateEvent = calendar?.updateEvent || calendar?.editEvent;
    if (!updateEvent) throw new Error('KayaCalendar.updateEvent() не е наличен');
    const payload = buildExternalEventPayload(fields);
    const result = await updateEvent.call(calendar, {
      ...payload,
      eventId: String(eventId),
      id: String(eventId),
    });
    return { branch: 'android', result };
  }

  async function deleteExternalEvent(eventId, webOperation) {
    if (!eventId) throw new Error('Липсва eventId');
    if (!isAndroid()) {
      if (typeof webOperation === 'function') return webOperation();
      return { branch: 'web', skipped: true };
    }
    const calendar = getCalendarPlugin();
    const removeEvent = calendar?.deleteEvent || calendar?.removeEvent;
    if (!removeEvent) throw new Error('KayaCalendar.deleteEvent() не е наличен');
    const result = await removeEvent.call(calendar, {
      eventId: String(eventId),
      id: String(eventId),
      calendarId: getSelectedCalendarId(),
    });
    return { branch: 'android', result };
  }

  async function readKayaEvents(params = {}, webOperation) {
    if (isAndroid()) {
      const calendar = getCalendarPlugin();
      const reader = calendar?.getEvents || calendar?.listEvents;
      if (!reader) return { branch: 'android', events: [] };
      const result = await reader.call(calendar, { calendarId: getSelectedCalendarId(), ...params });
      return { branch: 'android', events: result?.events || result || [] };
    }
    if (typeof webOperation === 'function') return webOperation();
    if (!params.userId || !params.provider) return { branch: 'web', events: [] };
    const base = window.KAYA_CONFIG?.API_BASE || window.KAYA_CONFIG?.WORKER_ORIGIN || location.origin;
    const query = new URLSearchParams({
      user_id: params.userId,
      provider: params.provider,
      from: params.from || '',
      to: params.to || '',
    });
    const res = await fetch(`${base}/api/calendar/events?${query.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Грешка при зареждане на събития');
    return { branch: 'web', events: data.events || [] };
  }

  window.KAYA_CALENDAR_CRUD = {
    getPlatform,
    isAndroid,
    requestPermissions,
    getCalendars,
    getSelectedCalendarId,
    setSelectedCalendarId,
    hasLocalEvent,
    getLocalEventIds,
    createKayaEvent,
    updateKayaEvent,
    deleteKayaEvent,
    readKayaEvents,
    updateExternalEvent,
    deleteExternalEvent,
  };
})();
