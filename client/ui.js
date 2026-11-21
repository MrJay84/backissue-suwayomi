window.BackIssue?.registerClient?.((api) => {
  const renameSettingsEntry = () => {
    for (const button of document.querySelectorAll('button')) {
      if (!button.textContent.includes('Plugin settings')) continue;
      const leaves = [...button.querySelectorAll('*')]
        .filter((element) => element.children.length === 0);
      const title = leaves.find((element) => element.textContent.trim() === 'Plugin');
      const subtitle = leaves.find((element) => element.textContent.trim() === 'Plugin settings');
      if (title) title.textContent = 'Suwayomi';
      if (subtitle) subtitle.textContent = 'Suwayomi settings';
    }
  };
  const observer = new MutationObserver(renameSettingsEntry);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  renameSettingsEntry();

  const sourceSlot = api.slot('settings-plugin-sources');
  let enabledInput = null;

  if (sourceSlot && !sourceSlot.querySelector('[data-suwayomi-bridge-source]')) {
    const sourceBlock = document.createElement('section');
    sourceBlock.className = 'src-block';
    sourceBlock.dataset.suwayomiBridgeSource = 'true';

    // Header wrapper
    const headerWrapper = document.createElement('div');
    headerWrapper.style.cssText = 'display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px;';

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'switch';
    enabledLabel.style.flexShrink = '0';
    enabledInput = document.createElement('input');
    enabledInput.id = 'set-suwayomi_bridgeEnabled';
    enabledInput.type = 'checkbox';
    const switchTrack = document.createElement('span');
    switchTrack.className = 'switch__track';
    enabledLabel.append(enabledInput, switchTrack);
    headerWrapper.appendChild(enabledLabel);

    const textContainer = document.createElement('div');
    textContainer.style.flexGrow = '1';

    const sourceHeading = document.createElement('h3');
    sourceHeading.textContent = 'Suwayomi';
    sourceHeading.style.margin = '0 0 4px 0';
    textContainer.appendChild(sourceHeading);

    const sourceHint = document.createElement('small');
    sourceHint.textContent = 'Search and download matching chapters from Suwayomi extensions.';
    textContainer.appendChild(sourceHint);

    headerWrapper.appendChild(textContainer);
    sourceBlock.appendChild(headerWrapper);

    // Server Address Field
    const addressField = document.createElement('label');
    addressField.className = 'field';
    const addressLabel = document.createElement('span');
    addressLabel.textContent = 'Suwayomi server address';
    addressField.appendChild(addressLabel);

    const addressInput = document.createElement('input');
    addressInput.id = 'set-suwayomi_bridgeUrl';
    addressInput.type = 'url';
    addressInput.inputMode = 'url';
    addressInput.placeholder = 'http://localhost:4567';
    addressInput.autocomplete = 'url';
    addressInput.spellcheck = false;
    addressField.appendChild(addressInput);

    const addressHint = document.createElement('small');
    addressHint.textContent = 'Use the Suwayomi address reachable from the BackIssue container, including http:// or https:// and the port.';
    addressField.appendChild(addressHint);
    sourceBlock.appendChild(addressField);

    // Username Field
    const userField = document.createElement('label');
    userField.className = 'field';
    const userLabel = document.createElement('span');
    userLabel.textContent = 'Suwayomi Username';
    userField.appendChild(userLabel);

    const userInput = document.createElement('input');
    userInput.id = 'set-suwayomi_bridgeUser';
    userInput.type = 'text';
    userInput.placeholder = 'Optional username';
    userInput.autocomplete = 'username';
    userInput.spellcheck = false;
    userField.appendChild(userInput);
    sourceBlock.appendChild(userField);

    // Password Field
    const passField = document.createElement('label');
    passField.className = 'field';
    const passLabel = document.createElement('span');
    passLabel.textContent = 'Suwayomi Password';
    passField.appendChild(passLabel);

    const passInput = document.createElement('input');
    passInput.id = 'set-suwayomi_bridgePass';
    passInput.type = 'password';
    passInput.placeholder = 'Optional password';
    passInput.autocomplete = 'current-password';
    passField.appendChild(passInput);
    sourceBlock.appendChild(passField);

    // Delete Originals Toggle (left switch, right text)
    const deleteWrapper = document.createElement('div');
    deleteWrapper.style.cssText = 'display: flex; align-items: flex-start; gap: 16px; margin-top: 8px; margin-bottom: 16px;';

    const deleteSwitchLabel = document.createElement('label');
    deleteSwitchLabel.className = 'switch';
    deleteSwitchLabel.style.flexShrink = '0';

    const deleteInput = document.createElement('input');
    deleteInput.id = 'set-suwayomi_deleteAfterCopy';
    deleteInput.type = 'checkbox';
    deleteInput.checked = true;

    const deleteSwitchTrack = document.createElement('span');
    deleteSwitchTrack.className = 'switch__track';
    deleteSwitchLabel.append(deleteInput, deleteSwitchTrack);

    const deleteTextContainer = document.createElement('div');
    deleteTextContainer.style.flexGrow = '1';

    const deleteTitle = document.createElement('div');
    deleteTitle.textContent = 'Delete originals';
    deleteTitle.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 2px;';

    const deleteHint = document.createElement('small');
    deleteHint.textContent = 'Delete the chapter download in Suwayomi after BackIssue copies the CBZ.';

    deleteTextContainer.append(deleteTitle, deleteHint);
    deleteWrapper.append(deleteSwitchLabel, deleteTextContainer);
    sourceBlock.appendChild(deleteWrapper);

    // Extensions / Sources Checklist Container
    const sourceField = document.createElement('div');
    sourceField.className = 'field';

    const sourceHeaderRow = document.createElement('div');
    sourceHeaderRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;';

    const sourceLabelTitle = document.createElement('span');
    sourceLabelTitle.textContent = 'Suwayomi Extensions / Sources';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Refresh Sources';
    refreshBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: inherit; cursor: pointer;';

    sourceHeaderRow.append(sourceLabelTitle, refreshBtn);
    sourceField.appendChild(sourceHeaderRow);

    // Hidden input bound to BackIssue's native settings persistence
    const hiddenSourceInput = document.createElement('input');
    hiddenSourceInput.id = 'set-suwayomi_sources';
    hiddenSourceInput.type = 'hidden';
    sourceField.appendChild(hiddenSourceInput);

    const statusText = document.createElement('small');
    statusText.style.cssText = 'display: block; margin-bottom: 8px; opacity: 0.8;';
    sourceField.appendChild(statusText);

    const checkboxList = document.createElement('div');
    checkboxList.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;';
    sourceField.appendChild(checkboxList);

    const checkboxes = new Map();

    const getSelectedNames = () => {
      const selected = [];
      for (const [name, cb] of checkboxes.entries()) {
        if (cb.checked) selected.push(name);
      }
      return selected;
    };

    const syncHiddenValue = () => {
      hiddenSourceInput.value = getSelectedNames().join(', ');
      hiddenSourceInput.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenSourceInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const renderSourceCheckboxes = (sourceNames, preselectedSet = new Set()) => {
      checkboxList.innerHTML = '';
      checkboxes.clear();

      for (const rawName of sourceNames) {
        const cleanName = String(rawName || '').trim();
        if (!cleanName) continue;
        const key = cleanName.toLowerCase();
        if (checkboxes.has(key)) continue;

        const pill = document.createElement('label');
        pill.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer; user-select: none; background: rgba(255,255,255,0.03);';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = preselectedSet.has(key);
        cb.style.cssText = 'width: 16px; height: 16px; accent-color: #e91e63; cursor: pointer; margin: 0;';
        cb.addEventListener('change', syncHiddenValue);

        const text = document.createElement('span');
        text.textContent = cleanName;
        text.style.cssText = 'font-size: 14px; text-transform: none; letter-spacing: normal;';

        pill.append(cb, text);
        checkboxList.appendChild(pill);
        checkboxes.set(key, cb);
      }
    };

    let isFetching = false;

    const fetchSuwayomiSources = async () => {
      if (isFetching) return;
      isFetching = true;
      statusText.textContent = 'Loading installed sources from Suwayomi...';
      refreshBtn.disabled = true;

      const params = new URLSearchParams();
      if (addressInput.value.trim()) params.set('url', addressInput.value.trim());
      if (userInput.value) params.set('user', userInput.value);
      if (passInput.value) params.set('pass', passInput.value);

      const endpoint = params.toString()
        ? `/api/plugins/suwayomi/sources?${params.toString()}`
        : '/api/plugins/suwayomi/sources';

      try {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (!payload.ok) {
          throw new Error(payload.error || 'Backend failed to query Suwayomi');
        }

        const remoteNames = (payload.sources || [])
          .filter((s) => String(s.id) !== '0')
          .map((s) => String(s.name || s.displayName || '').trim())
          .filter(Boolean);

        const savedNames = String(hiddenSourceInput.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        const selectedSet = new Set([
          ...getSelectedNames().map((s) => s.toLowerCase()),
          ...savedNames.map((s) => s.toLowerCase()),
        ]);

        const uniqueNames = [...new Set([...remoteNames, ...savedNames])];
        renderSourceCheckboxes(uniqueNames, selectedSet);

        statusText.textContent = remoteNames.length > 0
          ? `Found ${remoteNames.length} installed remote source${remoteNames.length === 1 ? '' : 's'} in Suwayomi.`
          : 'No remote sources found installed in Suwayomi.';
      } catch (err) {
        statusText.textContent = `Could not load sources via BackIssue backend (${err.message}).`;
      } finally {
        refreshBtn.disabled = false;
        isFetching = false;
      }
    };

    refreshBtn.addEventListener('click', fetchSuwayomiSources);

    const sourceHintText = document.createElement('small');
    sourceHintText.textContent = 'Tick the extensions you want to search. If none are ticked, all installed remote extensions will be searched.';
    sourceField.appendChild(sourceHintText);
    sourceBlock.appendChild(sourceField);

    sourceSlot.appendChild(sourceBlock);

    setTimeout(fetchSuwayomiSources, 400);

    enabledInput.addEventListener('change', () => api.refreshSourceUI?.());
  } else {
    enabledInput = sourceSlot?.querySelector('#set-suwayomi_bridgeEnabled') || null;
  }

  api.onSourcesSync?.(() => !!enabledInput?.checked);
});