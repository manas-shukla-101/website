

(function () {
  'use strict';

  const SECURE_STORE_KEY = '_sys_sec_vault';
  const LEGACY_STORE_KEY = 'vaultPracticals';
  const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

  const DEFAULT_SUBJECTS = [
    { name: 'Deep Learning', type: 'code', practicals: [] },
    { name: 'Computer Vision', type: 'code', practicals: [] },
    { name: 'Tableau', type: 'steps', practicals: [] },
    { name: 'R Programming', type: 'code', practicals: [] },
    { name: 'Business Forecasting', type: 'steps', practicals: [] }
  ];

  const CryptoEngine = {
    async deriveKey(password, saltUint8) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltUint8,
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    },

    async encrypt(dataObj, key, saltUint8) {
      const enc = new TextEncoder();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = JSON.stringify(dataObj);
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(plaintext)
      );
      return {
        v: 2,
        salt: Array.from(saltUint8).map(b => b.toString(16).padStart(2, '0')).join(''),
        iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
        ciphertext: Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('')
      };
    },

    async decrypt(payload, key) {
      const iv = new Uint8Array(payload.iv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const encryptedData = new Uint8Array(payload.ciphertext.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedData
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decrypted));
    }
  };

  const SupabaseSync = {
    client: null,
    isOnline: false,

    async init() {
      const defaultUrl = 'https://dxtssznoudmbigljgqgw.supabase.co';
      const defaultKey = 'sb_publishable_sDQwLl1CH6dJMULEA9Smuw_pMvNptZn';

      const url = window.SUPABASE_URL || defaultUrl;
      const key = window.SUPABASE_ANON_KEY || defaultKey;

      if (!window.supabase) {
        try {
          await new Promise(resolve => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
          });
        } catch (e) {}
      }

      if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          this.client = window.supabase.createClient(url, key);
          this.isOnline = true;
        } catch (err) {
          this.isOnline = false;
        }
      }
    },

    async fetchAll() {
      if (!this.isOnline || !this.client) return null;
      try {
        const { data, error } = await this.client
          .from('practicals')
          .select('*')
          .order('id', { ascending: true });
        return error ? null : data;
      } catch (e) {
        return null;
      }
    },

    async insertPractical(item) {
      if (!this.isOnline || !this.client) return false;
      try {
        const { error } = await this.client
          .from('practicals')
          .insert([{
            subject_name: item.subject_name,
            practical_title: item.practical_title,
            aim: item.aim,
            content: item.content,
            content_type: item.content_type
          }]);
        return !error;
      } catch (err) {
        return false;
      }
    },

    async deleteAllPracticals() {
      if (!this.isOnline || !this.client) return false;
      try {
        const { error } = await this.client.from('practicals').delete().gt('id', 0);
        return !error;
      } catch (e) {
        return false;
      }
    }
  };

  const AppEngine = {
    isOpen: false,
    cryptoKey: null,
    currentSalt: null,
    vaultData: [],
    activePracticalId: null,
    openFolderSet: new Set([0]),
    inactivityTimer: null,
    toastTimeout: null,
    boundEventListeners: {},

    async unlock(cryptoKey, saltUint8, password) {
      this.cryptoKey = cryptoKey;
      this.currentSalt = saltUint8;
      this.isOpen = true;

      
      this.ensureStylesheet();

      await this.loadVaultData(password);
      this.mountUI();
      this.renderFolderTree();
      this.setupSecurityListeners();

      SupabaseSync.init();
      if (SupabaseSync.isOnline) {
        SupabaseSync.fetchAll().then(items => {
          if (items && items.length > 0) {
            this.mergeCloudData(items);
          }
        });
      }
    },

    ensureStylesheet() {
      if (!document.getElementById('_sys_core_theme')) {
        const link = document.createElement('link');
        link.id = '_sys_core_theme';
        link.rel = 'stylesheet';
        link.href = 'vault.css';
        document.head.appendChild(link);
      }
    },

    removeStylesheet() {
      const link = document.getElementById('_sys_core_theme');
      if (link) link.remove();
    },

    async loadVaultData(password) {
      const encryptedStored = localStorage.getItem(SECURE_STORE_KEY);

      if (encryptedStored) {
        try {
          const payload = JSON.parse(encryptedStored);
          this.vaultData = await CryptoEngine.decrypt(payload, this.cryptoKey);
        } catch (err) {
          console.warn('[Core] Decryption re-init');
          this.vaultData = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
          await this.saveVaultData();
        }
      } else {
        const legacyData = localStorage.getItem(LEGACY_STORE_KEY);
        if (legacyData) {
          try {
            const parsed = JSON.parse(legacyData);
            this.vaultData = Array.isArray(parsed) && parsed.length > 0
              ? parsed
              : JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
            localStorage.removeItem(LEGACY_STORE_KEY);
          } catch (e) {
            this.vaultData = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
          }
        } else {
          this.vaultData = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
        }
        await this.saveVaultData();
      }
    },

    async saveVaultData() {
      if (!this.cryptoKey || !this.currentSalt) return;
      try {
        const encrypted = await CryptoEngine.encrypt(this.vaultData, this.cryptoKey, this.currentSalt);
        localStorage.setItem(SECURE_STORE_KEY, JSON.stringify(encrypted));
      } catch (err) {
        console.error('[Core] Save error:', err);
      }
    },

    mountUI() {
      this.unmountUI();

      const panel = document.createElement('div');
      panel.id = '_sys_protected_panel';
      panel.style.display = 'flex';
      panel.innerHTML = `
        <div class="vault-topbar">
          <div class="vault-brand">
            <span class="vault-logo-badge">VAULT</span>
            <h2>Practicals & Laboratory Journal Repository</h2>
          </div>
          <div class="vault-actions">
            <button class="vault-pill-btn primary" id="vaultAddBtn">
              ➕ Add Practical
            </button>
            <button class="vault-pill-btn" id="vaultSyncBtn">
              🔄 Sync Cloud
            </button>
            <button class="vault-exit-btn" id="vaultLockBtn">
              🔒 Lock
            </button>
          </div>
        </div>

        <div class="vault-body">
          <aside class="vault-sidebar">
            <div class="vault-search-box">
              <input 
                type="text" 
                id="vaultSearchInput" 
                class="vault-search-input" 
                placeholder="Search practicals by title or aim..." 
                autocomplete="off"
              />
            </div>
            <div class="vault-folder-tree" id="vaultFolderTree"></div>
          </aside>

          <main class="vault-content-viewer" id="vaultContentViewer">
            <div class="viewer-empty-state" id="viewerEmptyState">
              <div class="viewer-empty-icon">📁</div>
              <h3>Select a practical to view code or steps</h3>
              <p>Choose any practical from the subject folders on the left, or use the search bar above.</p>
            </div>
            <div id="viewerContentArea" style="display: none;"></div>
          </main>
        </div>
      `;
      document.body.appendChild(panel);

      const modal = document.createElement('div');
      modal.id = 'addPracticalModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>Add New Practical</h3>
            <button class="modal-close-btn" id="modalCloseBtn">&times;</button>
          </div>
          <form id="addPracticalForm">
            <div class="form-group">
              <label for="addSubjectSelect">Subject</label>
              <select id="addSubjectSelect" class="form-control" required>
                <option value="Deep Learning">Deep Learning (Code)</option>
                <option value="Computer Vision">Computer Vision (Code)</option>
                <option value="Tableau">Tableau (Steps)</option>
                <option value="R Programming">R Programming (Code)</option>
                <option value="Business Forecasting">Business Forecasting (Steps & Formulas)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="addTitleInput">Practical Title</label>
              <input type="text" id="addTitleInput" class="form-control" placeholder="e.g. Practical 1: Introduction to..." required />
            </div>
            <div class="form-group">
              <label for="addAimInput">Aim / Objective</label>
              <textarea id="addAimInput" class="form-control" placeholder="State the objective of this practical..." rows="2" required></textarea>
            </div>
            <div class="form-group">
              <label for="addContentInput" id="addContentLabel">Code Block</label>
              <textarea id="addContentInput" class="form-control" placeholder="Paste full code or steps here..." rows="6" required></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="vault-pill-btn" id="modalCancelBtn">Cancel</button>
              <button type="submit" class="vault-pill-btn primary">Save Practical</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      const toast = document.createElement('div');
      toast.id = 'clipboardToast';
      toast.className = 'toast-notice';
      toast.innerHTML = `<span>📋</span> Copied to clipboard!`;
      document.body.appendChild(toast);

      document.getElementById('vaultAddBtn').onclick = () => this.openAddModal();
      document.getElementById('vaultSyncBtn').onclick = () => this.syncCloudStorage();
      document.getElementById('vaultLockBtn').onclick = () => this.lock();
      document.getElementById('vaultSearchInput').oninput = (e) => this.renderFolderTree(e.target.value);

      document.getElementById('modalCloseBtn').onclick = () => this.closeAddModal();
      document.getElementById('modalCancelBtn').onclick = () => this.closeAddModal();
      document.getElementById('addSubjectSelect').onchange = (e) => this.handleSubjectChange(e.target.value);
      document.getElementById('addPracticalForm').onsubmit = (e) => {
        e.preventDefault();
        this.handleAddPracticalSubmit();
      };

      modal.onclick = (e) => {
        if (e.target === modal) this.closeAddModal();
      };
    },

    unmountUI() {
      const panel = document.getElementById('_sys_protected_panel');
      if (panel) panel.remove();

      const modal = document.getElementById('addPracticalModal');
      if (modal) modal.remove();

      const toast = document.getElementById('clipboardToast');
      if (toast) toast.remove();

      this.removeStylesheet();
    },

    setupSecurityListeners() {
      this.cleanupSecurityListeners();

      const resetInactivity = () => {
        if (!this.isOpen) return;
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
        this.inactivityTimer = setTimeout(() => {
          this.lock();
        }, INACTIVITY_TIMEOUT_MS);
      };

      this.boundEventListeners.resetInactivity = resetInactivity;
      ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetInactivity, { passive: true });
      });
      resetInactivity();

      const handleVisibilityChange = () => {
        if (document.hidden && this.isOpen) {
          this.lock();
        }
      };
      this.boundEventListeners.visibility = handleVisibilityChange;
      document.addEventListener('visibilitychange', handleVisibilityChange);

      const handleKeydown = (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          const modal = document.getElementById('addPracticalModal');
          if (modal && modal.style.display === 'flex') {
            this.closeAddModal();
          } else {
            this.lock();
          }
        }
      };
      this.boundEventListeners.keydown = handleKeydown;
      window.addEventListener('keydown', handleKeydown);
    },

    cleanupSecurityListeners() {
      if (this.inactivityTimer) {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = null;
      }
      if (this.boundEventListeners.resetInactivity) {
        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
          window.removeEventListener(evt, this.boundEventListeners.resetInactivity);
        });
      }
      if (this.boundEventListeners.visibility) {
        document.removeEventListener('visibilitychange', this.boundEventListeners.visibility);
      }
      if (this.boundEventListeners.keydown) {
        window.removeEventListener('keydown', this.boundEventListeners.keydown);
      }
      this.boundEventListeners = {};
    },

    lock() {
      this.isOpen = false;
      this.unmountUI();
      this.cleanupSecurityListeners();

      this.cryptoKey = null;
      this.currentSalt = null;
      this.vaultData = [];
      this.activePracticalId = null;

      if (window._sysGateway && typeof window._sysGateway.closeGate === 'function') {
        window._sysGateway.closeGate();
      }

      
      try {
        delete window._CoreRuntime;
      } catch (e) {
        window._CoreRuntime = undefined;
      }
    },

    renderFolderTree(filterQuery = '') {
      const treeContainer = document.getElementById('vaultFolderTree');
      if (!treeContainer) return;
      treeContainer.innerHTML = '';
      const query = filterQuery.trim().toLowerCase();

      this.vaultData.forEach((subject, sIdx) => {
        const filteredPracticals = subject.practicals.filter(p => {
          if (!query) return true;
          const matchTitle = (p.title || '').toLowerCase().includes(query);
          const matchAim = (p.aim || '').toLowerCase().includes(query);
          return matchTitle || matchAim;
        });

        if (query && filteredPracticals.length === 0) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'subject-group';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'subject-header';
        const isOpen = query.length > 0 || this.openFolderSet.has(sIdx);

        headerDiv.innerHTML = `
          <div class="subject-header-left">
            <span class="folder-arrow ${isOpen ? 'open' : ''}">▶</span>
            <span>${this.escapeHtml(subject.name)}</span>
          </div>
          <span class="subject-badge ${subject.type === 'code' ? 'badge-code' : 'badge-steps'}">
            ${subject.type === 'code' ? 'Code' : 'Steps'} (${subject.practicals.length})
          </span>
        `;

        const sublistDiv = document.createElement('div');
        sublistDiv.className = `practical-sublist ${isOpen ? 'open' : ''}`;

        if (filteredPracticals.length === 0) {
          const emptyItem = document.createElement('div');
          emptyItem.className = 'practical-item';
          emptyItem.style.fontStyle = 'italic';
          emptyItem.style.color = '#64748b';
          emptyItem.style.cursor = 'default';
          emptyItem.innerHTML = `<span>(No practicals added yet)</span>`;
          sublistDiv.appendChild(emptyItem);
        } else {
          filteredPracticals.forEach((p) => {
            const itemDiv = document.createElement('div');
            const isSelected = this.activePracticalId === `${sIdx}_${p.title}`;
            itemDiv.className = `practical-item ${isSelected ? 'active' : ''}`;
            itemDiv.innerHTML = `
              <span class="practical-item-dot"></span>
              <span title="${this.escapeHtml(p.title)}">${this.escapeHtml(p.title)}</span>
            `;
            itemDiv.onclick = (e) => {
              e.stopPropagation();
              this.selectPractical(subject, p, `${sIdx}_${p.title}`);
            };
            sublistDiv.appendChild(itemDiv);
          });
        }

        headerDiv.onclick = () => {
          const arrow = headerDiv.querySelector('.folder-arrow');
          if (this.openFolderSet.has(sIdx)) {
            this.openFolderSet.delete(sIdx);
            sublistDiv.classList.remove('open');
            if (arrow) arrow.classList.remove('open');
          } else {
            this.openFolderSet.add(sIdx);
            sublistDiv.classList.add('open');
            if (arrow) arrow.classList.add('open');
          }
        };

        groupDiv.appendChild(headerDiv);
        groupDiv.appendChild(sublistDiv);
        treeContainer.appendChild(groupDiv);
      });
    },

    selectPractical(subject, practical, practicalKey) {
      this.activePracticalId = practicalKey;
      const searchVal = document.getElementById('vaultSearchInput') ? document.getElementById('vaultSearchInput').value : '';
      this.renderFolderTree(searchVal);

      const emptyState = document.getElementById('viewerEmptyState');
      const contentArea = document.getElementById('viewerContentArea');
      if (emptyState) emptyState.style.display = 'none';
      if (!contentArea) return;
      contentArea.style.display = 'block';

      const isCode = subject.type === 'code';
      const bodyContent = isCode ? (practical.code || '') : (practical.steps || '');

      contentArea.innerHTML = `
        <article class="practical-card">
          <div class="practical-header-area">
            <div class="practical-tag-row">
              <span class="practical-subj-tag">📂 ${this.escapeHtml(subject.name)}</span>
              <span class="subject-badge ${isCode ? 'badge-code' : 'badge-steps'}">
                ${isCode ? 'Source Code' : 'Procedure & Calculations'}
              </span>
            </div>
            <h1 class="practical-title-text">${this.escapeHtml(practical.title)}</h1>
            <div class="aim-container">
              <span class="aim-label">Aim / Objective</span>
              <div class="aim-body">${this.escapeHtml(practical.aim || 'To complete the assigned lab experiment.')}</div>
            </div>
          </div>
          <div class="content-block-area">
            <div class="content-top-bar">
              <span class="content-type-title">${isCode ? 'Program Code' : 'Steps & Formulas'}</span>
              <button class="copy-button" id="practicalCopyBtn">
                <span>📄</span> Copy to Clipboard
              </button>
            </div>
            ${isCode 
              ? `<pre class="code-container" id="activeContentBlock">${this.escapeHtml(bodyContent)}</pre>`
              : `<div class="steps-container" id="activeContentBlock">${this.escapeHtml(bodyContent)}</div>`
            }
          </div>
        </article>
      `;

      const copyBtn = document.getElementById('practicalCopyBtn');
      if (copyBtn) {
        copyBtn.onclick = () => this.copyContentToClipboard();
      }
    },

    copyContentToClipboard() {
      const contentBlock = document.getElementById('activeContentBlock');
      if (!contentBlock) return;
      const text = contentBlock.innerText;

      const finishCopy = () => {
        this.showToast('<span>📋</span> Copied to clipboard!');
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(finishCopy).catch(() => {
          this.fallbackCopy(text);
          finishCopy();
        });
      } else {
        this.fallbackCopy(text);
        finishCopy();
      }
    },

    fallbackCopy(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    },

    showToast(htmlContent) {
      const toast = document.getElementById('clipboardToast');
      if (!toast) return;
      toast.innerHTML = htmlContent;
      toast.classList.add('show');
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    },

    openAddModal() {
      const modal = document.getElementById('addPracticalModal');
      if (modal) {
        modal.style.display = 'flex';
        const subjSelect = document.getElementById('addSubjectSelect');
        if (subjSelect) this.handleSubjectChange(subjSelect.value);
        const titleInput = document.getElementById('addTitleInput');
        if (titleInput) setTimeout(() => titleInput.focus(), 50);
      }
    },

    closeAddModal() {
      const modal = document.getElementById('addPracticalModal');
      if (modal) modal.style.display = 'none';
      const form = document.getElementById('addPracticalForm');
      if (form) form.reset();
    },

    handleSubjectChange(subjName) {
      const label = document.getElementById('addContentLabel');
      if (!label) return;
      const isSteps = subjName === 'Tableau' || subjName === 'Business Forecasting';
      label.innerText = isSteps ? 'Steps & Formulas' : 'Code Block';
    },

    async handleAddPracticalSubmit() {
      const subjName = document.getElementById('addSubjectSelect').value;
      const title = document.getElementById('addTitleInput').value.trim();
      const aim = document.getElementById('addAimInput').value.trim();
      const content = document.getElementById('addContentInput').value.trim();

      let subject = this.vaultData.find(s => s.name.toLowerCase() === subjName.toLowerCase());
      if (!subject) {
        const type = (subjName === 'Tableau' || subjName === 'Business Forecasting') ? 'steps' : 'code';
        subject = { name: subjName, type: type, practicals: [] };
        this.vaultData.push(subject);
      }

      const newPractical = { title, aim };
      if (subject.type === 'code') {
        newPractical.code = content;
      } else {
        newPractical.steps = content;
      }

      subject.practicals.push(newPractical);
      await this.saveVaultData();

      if (SupabaseSync.isOnline) {
        await SupabaseSync.insertPractical({
          subject_name: subject.name,
          practical_title: title,
          aim: aim,
          content: content,
          content_type: subject.type
        });
      }

      this.closeAddModal();
      this.renderFolderTree();
      this.selectPractical(subject, newPractical, `${this.vaultData.indexOf(subject)}_${title}`);
      this.showToast('<span>✓</span> Practical securely encrypted & saved!');
    },

    async syncCloudStorage() {
      if (SupabaseSync.isOnline) {
        const items = await SupabaseSync.fetchAll();
        if (items) {
          this.mergeCloudData(items);
          this.showToast('<span>✓</span> Cloud synchronization complete!');
        } else {
          this.showToast('<span>⚠️</span> Cloud fetch error.');
        }
      } else {
        this.showToast('<span>🔒</span> Offline mode active (Local AES-256 Storage)');
      }
    },

    mergeCloudData(cloudItems) {
      cloudItems.forEach(item => {
        let subject = this.vaultData.find(s => s.name.toLowerCase() === item.subject_name.toLowerCase());
        if (!subject) {
          subject = {
            name: item.subject_name,
            type: item.content_type || 'code',
            practicals: []
          };
          this.vaultData.push(subject);
        }
        const exists = subject.practicals.some(p => p.title.toLowerCase() === item.practical_title.toLowerCase());
        if (!exists) {
          const newP = {
            title: item.practical_title,
            aim: item.aim || ''
          };
          if (subject.type === 'code') {
            newP.code = item.content;
          } else {
            newP.steps = item.content;
          }
          subject.practicals.push(newP);
        }
      });
      this.saveVaultData();
      this.renderFolderTree();
    },

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  };

  window._CoreRuntime = {
    engine: AppEngine,
    crypto: CryptoEngine
  };
})();
