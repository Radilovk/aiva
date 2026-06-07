/**
 * AIVA Device Calendar
 * Saves a task as an event into the calendar app used on the device itself.
 *
 * Strategy (no extra native plugins):
 *   1. Build a single-event ICS for the task.
 *   2. On native/mobile (Web Share API with files) hand the .ics to the OS
 *      share sheet so the user picks their device calendar app.
 *   3. Otherwise download/open the .ics so the default calendar app imports it.
 */
(function () {
  const pad = (n) => String(n).padStart(2, '0');

  function escapeICS(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function stamp(date) {
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

  function buildICS(task) {
    if (!task || !task.due_date) return null;

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

    const uid = `aiva-task-${task.id || Date.now()}@aiva`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AIVA//Task Calendar//BG',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escapeICS(task.content)}`,
    ];
    if (task.notes) lines.push(`DESCRIPTION:${escapeICS(task.notes)}`);
    if (task.location) lines.push(`LOCATION:${escapeICS(task.location)}`);
    if (task.tags) lines.push(`CATEGORIES:${escapeICS(task.tags)}`);
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${escapeICS(task.content)}`, 'END:VALARM');
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
  }

  async function addToDevice(task) {
    const ics = buildICS(task);
    if (!ics) {
      throw new Error('Задачата няма дата — не може да се добави в календара');
    }

    const fileName = `aiva-${(task.id || 'task')}.ics`;
    const blob = new Blob([ics], { type: 'text/calendar' });

    // Preferred: hand the event to the device's calendar app via the share sheet.
    try {
      const file = new File([blob], fileName, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: task.content || 'AIVA задача' });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
      // Fall through to download fallback.
    }

    // Fallback: download / open the .ics so the default calendar app imports it.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  }

  window.AIVA_CALENDAR = { addToDevice, buildICS };
})();
