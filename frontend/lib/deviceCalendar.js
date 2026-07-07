/**
 * KAYA Device Calendar
 * Saves a task as an event into the calendar app used on the device itself.
 *
 * Strategy:
 *   1. Build ICS with Europe/Sofia timezone + configurable reminders.
 *   2. On mobile → Web Share API hands .ics to OS calendar picker.
 *   3. On web → download .ics or Google Calendar deep link.
 */
(function () {
  function getReminderOptions() {
    const settings = window.KAYA_SETTINGS?.loadAssistantSettings?.() || {};
    return {
      reminderMinutes: settings.notifications?.reminderMinutes ?? 15,
      remindAtStart: settings.notifications?.remindAtStart !== false,
    };
  }

  function buildICS(task, options = {}) {
    const ics = window.KAYA_ICS;
    if (!ics) {
      throw new Error('ICS utilities not loaded');
    }
    return ics.buildICS(task, { ...getReminderOptions(), ...options });
  }

  async function shareOrDownloadICS(task, ics, fileName) {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });

    try {
      const file = new File([blob], fileName, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: task.content || 'KAYA задача' });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
    }

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

  async function addToDevice(task, options = {}) {
    const ics = buildICS(task, options);
    if (!ics) {
      throw new Error('Задачата няма дата — не може да се добави в календара');
    }

    const fileName = `kaya-${task.id || 'task'}.ics`;
    return shareOrDownloadICS(task, ics, fileName);
  }

  window.KAYA_CALENDAR = { addToDevice, buildICS, shareOrDownloadICS };
})();
