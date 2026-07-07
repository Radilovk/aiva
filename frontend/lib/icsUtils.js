/**
 * Shared ICS (iCalendar) utilities for KAYA.
 * Uses Europe/Sofia timezone consistently across web, PWA and APK.
 */
(function () {
  const SOFIA_TZ = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Sofia',
    'BEGIN:STANDARD',
    'DTSTART:19701025T040000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0200',
    'TZNAME:EET',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T030000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0300',
    'TZNAME:EEST',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
  ];

  const pad = (n) => String(n).padStart(2, '0');

  function escapeICS(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function stampUTC(date) {
    return (
      date.getUTCFullYear() +
      pad(date.getUTCMonth() + 1) +
      pad(date.getUTCDate()) +
      'T' +
      pad(date.getUTCHours()) +
      pad(date.getUTCMinutes()) +
      pad(date.getUTCSeconds()) +
      'Z'
    );
  }

  function parseTaskDateTime(task) {
    if (!task?.due_date) return null;

    const [y, m, d] = task.due_date.split('-').map(Number);
    let h = 9;
    let min = 0;
    if (task.due_time) {
      const parts = task.due_time.split(':').map(Number);
      h = parts[0] || 0;
      min = parts[1] || 0;
    }

    const start = new Date(y, m - 1, d, h, min);
    const durationMin = Number(task.estimated_minutes) || 30;
    const end = new Date(start.getTime() + durationMin * 60000);

    const dateStr = task.due_date.replace(/-/g, '');
    const timeStr = task.due_time ? task.due_time.replace(':', '') + '00' : '090000';
    const dtStart = `${dateStr}T${timeStr}`;

    const endTotal = h * 60 + min + durationMin;
    const endH = pad(Math.floor(endTotal / 60) % 24);
    const endM = pad(endTotal % 60);
    const dtEnd = `${dateStr}T${endH}${endM}00`;

    return { start, end, dtStart, dtEnd, durationMin };
  }

  function getTaskUid(task) {
    return `kaya-task-${task.id || Date.now()}@kaya`;
  }

  function buildValarms(task, options = {}) {
    const reminderMinutes = options.reminderMinutes ?? 15;
    const remindAtStart = options.remindAtStart !== false;
    const alarms = [];

    if (reminderMinutes > 0) {
      alarms.push({
        trigger: `-PT${reminderMinutes}M`,
        description: task.content,
      });
    }
    if (remindAtStart) {
      alarms.push({
        trigger: '-PT0M',
        description: `Започва: ${task.content}`,
      });
    }

    const lines = [];
    for (const alarm of alarms) {
      lines.push('BEGIN:VALARM');
      lines.push(`TRIGGER:${alarm.trigger}`);
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeICS(alarm.description)}`);
      lines.push('END:VALARM');
    }
    return lines;
  }

  function buildEventLines(task, options = {}) {
    const parsed = parseTaskDateTime(task);
    if (!parsed) return null;

    const uid = getTaskUid(task);
    const modified = stampUTC(new Date(task.updated_at || task.created_at || Date.now()));

    const lines = [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stampUTC(new Date())}`,
      `LAST-MODIFIED:${modified}`,
      `DTSTART;TZID=Europe/Sofia:${parsed.dtStart}`,
      `DTEND;TZID=Europe/Sofia:${parsed.dtEnd}`,
      `SUMMARY:${escapeICS(task.content)}`,
    ];

    if (task.notes) lines.push(`DESCRIPTION:${escapeICS(task.notes)}`);
    if (task.location) lines.push(`LOCATION:${escapeICS(task.location)}`);
    if (task.priority) lines.push(`PRIORITY:${Math.min(9, (task.priority || 3) * 2)}`);
    if (task.tags) lines.push(`CATEGORIES:${escapeICS(task.tags)}`);
    if (task.repeat_rule) lines.push(`X-KAYA-REPEAT:${escapeICS(task.repeat_rule)}`);

    lines.push(...buildValarms(task, options));
    lines.push('END:VEVENT');
    return lines;
  }

  function buildICS(task, options = {}) {
    const eventLines = buildEventLines(task, options);
    if (!eventLines) return null;

    const includeTimezone = options.includeTimezone !== false;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KAYA//Task Calendar//BG',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    if (options.calendarName) lines.push(`X-WR-CALNAME:${escapeICS(options.calendarName)}`);
    if (options.includeRefresh) {
      lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT15M');
      lines.push('X-PUBLISHED-TTL:PT15M');
    }
    if (includeTimezone) {
      lines.push('X-WR-TIMEZONE:Europe/Sofia');
      lines.push(...SOFIA_TZ);
    }

    lines.push(...eventLines);
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function buildMultiICS(tasks, options = {}) {
    const withDates = (tasks || []).filter((t) => t.due_date);
    if (!withDates.length) return null;

    const includeTimezone = options.includeTimezone !== false;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KAYA//Task Calendar//BG',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeICS(options.calendarName || 'KAYA Задачи')}`,
    ];

    if (options.includeRefresh) {
      lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT15M');
      lines.push('X-PUBLISHED-TTL:PT15M');
    }
    if (includeTimezone) {
      lines.push('X-WR-TIMEZONE:Europe/Sofia');
      lines.push(...SOFIA_TZ);
    }

    for (const task of withDates) {
      const eventLines = buildEventLines(task, options);
      if (eventLines) lines.push(...eventLines);
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /** Google Calendar deep-link for quick add (works on web + mobile browsers). */
  function getGoogleCalendarUrl(task) {
    const parsed = parseTaskDateTime(task);
    if (!parsed) return null;

    const fmt = (d) =>
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      '00';

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: task.content || 'KAYA задача',
      dates: `${fmt(parsed.start)}/${fmt(parsed.end)}`,
      ctz: 'Europe/Sofia',
    });
    if (task.notes) params.set('details', task.notes);
    if (task.location) params.set('location', task.location);

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  window.KAYA_ICS = {
    SOFIA_TZ,
    escapeICS,
    stampUTC,
    parseTaskDateTime,
    getTaskUid,
    buildValarms,
    buildEventLines,
    buildICS,
    buildMultiICS,
    getGoogleCalendarUrl,
  };
})();
