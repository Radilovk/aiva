const { loadAssistantSettings, saveAssistantSettings, resetAssistantSettings, DEFAULT_ASSISTANT_SETTINGS } = window.AIVA_SETTINGS;

const form = document.getElementById('adminForm');
const saveState = document.getElementById('saveState');
const promptField = document.getElementById('systemInstructions');
const modelField = document.getElementById('model');
const voiceField = document.getElementById('voiceName');
const temperatureField = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperatureValue');
const responseAudioField = document.getElementById('responseAudio');
const responseTextField = document.getElementById('responseText');
const inputAudioTranscriptionField = document.getElementById('inputAudioTranscription');
const outputAudioTranscriptionField = document.getElementById('outputAudioTranscription');
const googleGroundingField = document.getElementById('googleGrounding');
const vadDisabledField = document.getElementById('vadDisabled');
const silenceDurationField = document.getElementById('silenceDuration');
const prefixPaddingField = document.getElementById('prefixPadding');
const startSensitivityField = document.getElementById('startSensitivity');
const endSensitivityField = document.getElementById('endSensitivity');
const activityHandlingField = document.getElementById('activityHandling');
const defaultViewField = document.getElementById('defaultView');
const weekStartsOnField = document.getElementById('weekStartsOn');
const workingDayStartField = document.getElementById('workingDayStart');
const workingDayEndField = document.getElementById('workingDayEnd');
const showUnscheduledField = document.getElementById('showUnscheduled');
const defaultPriorityField = document.getElementById('defaultPriority');
const defaultEstimatedMinutesField = document.getElementById('defaultEstimatedMinutes');
const defaultDueTimeField = document.getElementById('defaultDueTime');
const askBeforeDeleteField = document.getElementById('askBeforeDelete');
const showCompletedTasksField = document.getElementById('showCompletedTasks');
const maxDuplicateDaysField = document.getElementById('maxDuplicateDays');
const accentColorField = document.getElementById('accentColor');
const compactCalendarField = document.getElementById('compactCalendar');
const exportOutput = document.getElementById('exportOutput');
const setupPreview = document.getElementById('setupPreview');

function setSaveState(text) {
  saveState.textContent = text;
  saveState.classList.add('visible');
  setTimeout(() => saveState.classList.remove('visible'), 2600);
}

function getModalities(settings) {
  const modalities = [];
  if (responseAudioField.checked) modalities.push('AUDIO');
  if (responseTextField.checked) modalities.push('TEXT');
  return modalities.length ? modalities : settings.responseModalities;
}

function renderSettings(settings) {
  document.documentElement.style.setProperty('--accent', settings.appearance.accentColor);
  window.AIVA_VOICES?.populateVoiceSelect?.(voiceField, settings.voiceName);
  promptField.value = settings.systemInstructions;
  modelField.value = settings.model;
  voiceField.value = settings.voiceName;
  temperatureField.value = settings.temperature;
  temperatureValue.textContent = Number(settings.temperature).toFixed(1);
  responseAudioField.checked = settings.responseModalities.includes('AUDIO');
  responseTextField.checked = settings.responseModalities.includes('TEXT');
  inputAudioTranscriptionField.checked = settings.inputAudioTranscription;
  outputAudioTranscriptionField.checked = settings.outputAudioTranscription;
  googleGroundingField.checked = settings.googleGrounding;
  vadDisabledField.checked = settings.automaticActivityDetection.disabled;
  silenceDurationField.value = settings.automaticActivityDetection.silence_duration_ms;
  prefixPaddingField.value = settings.automaticActivityDetection.prefix_padding_ms;
  startSensitivityField.value = settings.automaticActivityDetection.start_of_speech_sensitivity;
  endSensitivityField.value = settings.automaticActivityDetection.end_of_speech_sensitivity;
  activityHandlingField.value = settings.activityHandling;
  defaultViewField.value = settings.calendar.defaultView;
  weekStartsOnField.value = String(settings.calendar.weekStartsOn);
  workingDayStartField.value = settings.calendar.workingDayStart;
  workingDayEndField.value = settings.calendar.workingDayEnd;
  showUnscheduledField.checked = settings.calendar.showUnscheduled;
  defaultPriorityField.value = settings.defaults.priority;
  defaultEstimatedMinutesField.value = settings.defaults.estimatedMinutes;
  defaultDueTimeField.value = settings.defaults.dueTime;
  askBeforeDeleteField.checked = settings.safety.askBeforeDelete;
  showCompletedTasksField.checked = settings.safety.showCompletedTasks;
  maxDuplicateDaysField.value = settings.safety.maxDuplicateDays;
  accentColorField.value = settings.appearance.accentColor;
  compactCalendarField.checked = settings.appearance.compactCalendar;
  renderPreview(settings);
}

function collectSettings() {
  const existing = loadAssistantSettings();
  return {
    ...existing,
    systemInstructions: promptField.value.trim(),
    instructionsCustomized:
      promptField.value.trim() !== DEFAULT_ASSISTANT_SETTINGS.systemInstructions.trim(),
    model: modelField.value.trim(),
    voiceName: voiceField.value,
    temperature: Number(temperatureField.value),
    responseModalities: getModalities(existing),
    inputAudioTranscription: inputAudioTranscriptionField.checked,
    outputAudioTranscription: outputAudioTranscriptionField.checked,
    googleGrounding: googleGroundingField.checked,
    automaticActivityDetection: {
      disabled: vadDisabledField.checked,
      silence_duration_ms: parseInt(silenceDurationField.value, 10),
      prefix_padding_ms: parseInt(prefixPaddingField.value, 10),
      start_of_speech_sensitivity: startSensitivityField.value,
      end_of_speech_sensitivity: endSensitivityField.value,
    },
    activityHandling: activityHandlingField.value,
    calendar: {
      defaultView: defaultViewField.value,
      weekStartsOn: parseInt(weekStartsOnField.value, 10),
      workingDayStart: workingDayStartField.value,
      workingDayEnd: workingDayEndField.value,
      showUnscheduled: showUnscheduledField.checked,
    },
    defaults: {
      priority: parseInt(defaultPriorityField.value, 10),
      estimatedMinutes: parseInt(defaultEstimatedMinutesField.value, 10),
      dueTime: defaultDueTimeField.value,
      emotion: existing.defaults.emotion,
    },
    safety: {
      askBeforeDelete: askBeforeDeleteField.checked,
      showCompletedTasks: showCompletedTasksField.checked,
      maxDuplicateDays: parseInt(maxDuplicateDaysField.value, 10),
    },
    appearance: {
      accentColor: accentColorField.value,
      compactCalendar: compactCalendarField.checked,
    },
  };
}

function renderPreview(settings) {
  setupPreview.textContent = JSON.stringify(
    {
      model: settings.model,
      generationConfig: {
        responseModalities: settings.responseModalities,
        temperature: settings.temperature,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: settings.voiceName,
            },
          },
        },
      },
      inputAudioTranscription: settings.inputAudioTranscription ? {} : undefined,
      outputAudioTranscription: settings.outputAudioTranscription ? {} : undefined,
      googleGrounding: settings.googleGrounding,
      realtimeInputConfig: {
        automaticActivityDetection: settings.automaticActivityDetection,
        activityHandling: settings.activityHandling,
      },
    },
    null,
    2
  );
}

function handleSave(event) {
  event.preventDefault();
  const settings = saveAssistantSettings(collectSettings());
  renderSettings(settings);
  setSaveState('Настройките са запазени. Ще се приложат при следваща voice сесия.');
}

form.addEventListener('input', () => {
  const settings = collectSettings();
  temperatureValue.textContent = Number(settings.temperature).toFixed(1);
  renderPreview(settings);
});

form.addEventListener('submit', handleSave);

document.getElementById('resetSettings').addEventListener('click', () => {
  if (!confirm('Да върна ли фабричните настройки на асистента?')) return;
  const settings = resetAssistantSettings();
  renderSettings(settings);
  setSaveState('Върнати са настройките по подразбиране.');
});

document.getElementById('exportSettings').addEventListener('click', () => {
  exportOutput.value = JSON.stringify(loadAssistantSettings(), null, 2);
  exportOutput.select();
  setSaveState('JSON конфигурацията е готова за копиране.');
});

document.getElementById('importSettings').addEventListener('click', () => {
  try {
    const parsed = JSON.parse(exportOutput.value);
    const settings = saveAssistantSettings(parsed);
    renderSettings(settings);
    setSaveState('Импортът е успешен.');
  } catch (e) {
    setSaveState('Невалиден JSON за импорт.');
  }
});

renderSettings(loadAssistantSettings());
