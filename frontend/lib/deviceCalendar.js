/**
 * AIVA Device Calendar
 * Saves a task as an event into the calendar app used on the device itself.
 *
 * Strategy:
 *   1. Build ICS with Europe/Sofia timezone + configurable reminders.
 *   2. On mobile → Web Share API hands .ics to OS calendar picker.
 *   3. On web → Web Share API or Google Calendar deep link (no silent download).
 */
(function () {
  function getReminderOptions() {
    const settings = window.AIVA_SETTINGS?.loadAssistantSettings?.() || {};
    return {
      reminderMinutes: settings.notifications?.reminderMinutes ?? 15,
      remindAtStart: settings.notifications?.remindAtStart !== false,
    };
  }

  function buildICS(task, options = {}) {
    const ics = window.AIVA_ICS;
    if (!ics) {
      throw new Error('ICS utilities not loaded');
    }
    return ics.buildICS(task, { ...getReminderOptions(), ...options });
  }

  async function shareOrDownloadICS(task, ics, fileName) {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });

    try {
      const file = new File([blob], fileName, { type: 'text/calendar' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: task.content || 'KASY задача' });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
      throw e;
    }

    throw new Error(
      window.AIVA_I18N?.t?.('errShareUnavailable')
        || 'Споделянето не е налично. Използвайте „Добави в Google Calendar“ или ICS абонамент.'
    );
  }

  async function addToDevice(task, options = {}) {
    const ics = buildICS(task, options);
    if (!ics) {
      throw new Error('Задачата няма дата — не може да се добави в календара');
    }

    const fileName = `aiva-${task.id || 'task'}.ics`;
    return shareOrDownloadICS(task, ics, fileName);
  }

  window.AIVA_CALENDAR = { addToDevice, buildICS, shareOrDownloadICS };
})();
