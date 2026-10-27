

(function () {
  'use strict';

  
  document.addEventListener('DOMContentLoaded', () => {
    
    const navLinks = document.querySelectorAll('.nav-menu a, .hero-actions a');
    navLinks.forEach(link => {
      link.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId && targetId.startsWith('#') && targetId.length > 1) {
          const targetEl = document.querySelector(targetId);
          if (targetEl) {
            e.preventDefault();
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });

    
    window.addEventListener('scroll', () => {
      const scrollPos = window.scrollY + 100;
      const sections = document.querySelectorAll('section[id], article[id], main[id]');
      sections.forEach(sec => {
        if (scrollPos >= sec.offsetTop && scrollPos < sec.offsetTop + sec.offsetHeight) {
          const id = sec.getAttribute('id');
          document.querySelectorAll('.nav-item').forEach(item => {
            const anchor = item.querySelector('a');
            if (anchor && anchor.getAttribute('href') === '#' + id) {
              item.classList.add('active');
            } else {
              item.classList.remove('active');
            }
          });
        }
      });
    }, { passive: true });
  });

  
  const _AUTH_HASH = "e00c19d070bfa41d54232e38d28d216f1ada7b88a418ca17fb00081cb4c574a3";
  const _SYS_SALT = new Uint8Array([0x74, 0x73, 0x64, 0x63, 0x5f, 0x73, 0x65, 0x63, 0x5f, 0x76, 0x32, 0x5f, 0x32, 0x30, 0x32, 0x36]);

  let _authPanel = null;
  let _failedCount = 0;

  async function _computeHash(msg) {
    const buf = new TextEncoder().encode(msg);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function _fetchEngine() {
    if (window._CoreRuntime && window._CoreRuntime.engine) {
      return Promise.resolve(window._CoreRuntime);
    }
    return new Promise((resolve, reject) => {
      const existing = document.getElementById('_sys_runtime_script');
      if (existing) existing.remove();
      const el = document.createElement('script');
      el.id = '_sys_runtime_script';
      el.src = 'assets/core/runtime.js?t=' + Date.now();
      el.onload = () => {
        if (window._CoreRuntime && window._CoreRuntime.engine) {
          resolve(window._CoreRuntime);
        } else {
          reject(new Error('Runtime engine not initialized'));
        }
      };
      el.onerror = () => reject(new Error('Failed to load assets/core/runtime.js. Please check path.'));
      document.body.appendChild(el);
    });
  }

  const AdminGateway = {
    open() {
      if (window._CoreRuntime && window._CoreRuntime.engine && window._CoreRuntime.engine.isOpen) return;
      if (_authPanel) return;

      _authPanel = document.createElement('div');
      _authPanel.id = '_sys_auth_overlay';
      _authPanel.className = 'ovl-auth-container';
      _authPanel.innerHTML = `
        <div class="ovl-auth-box" id="_sys_auth_box">
          <div class="ovl-auth-icon">🏛️</div>
          <h2>TSDC Academic Administration</h2>
          <p>Institutional security authorization required to proceed.</p>
          <form id="_sys_auth_form">
            <div class="ovl-form-group">
              <input 
                type="password" 
                id="_sys_auth_input" 
                class="ovl-input" 
                placeholder="Security Authorization Key" 
                autocomplete="off" 
                required 
              />
              <div id="_sys_auth_err" class="ovl-error-msg">Invalid authorization credential.</div>
            </div>
            <button type="submit" class="ovl-submit-btn" id="_sys_auth_submit_btn">Verify Credential</button>
            <button type="button" class="ovl-cancel-btn" id="_sys_auth_cancel_btn">Return to Portal</button>
          </form>
        </div>
      `;
      document.body.appendChild(_authPanel);

      const form = document.getElementById('_sys_auth_form');
      const submitBtn = document.getElementById('_sys_auth_submit_btn');
      const cancelBtn = document.getElementById('_sys_auth_cancel_btn');
      const input = document.getElementById('_sys_auth_input');

      const doSubmit = (e) => {
        if (e) e.preventDefault();
        this.verify();
      };

      if (form) form.onsubmit = doSubmit;
      if (submitBtn) submitBtn.onclick = doSubmit;
      if (cancelBtn) cancelBtn.onclick = () => this.close();

      _authPanel.onclick = (e) => {
        if (e.target === _authPanel) this.close();
      };

      setTimeout(() => input && input.focus(), 60);
    },

    close() {
      if (_authPanel) {
        _authPanel.remove();
        _authPanel = null;
      }
    },

    async verify() {
      const input = document.getElementById('_sys_auth_input');
      const btn = document.getElementById('_sys_auth_submit_btn');
      const err = document.getElementById('_sys_auth_err');
      const box = document.getElementById('_sys_auth_box');

      const val = input ? input.value.trim() : '';
      if (!val) {
        if (input) input.focus();
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Verifying...';
      }

      let unlockStarted = false;

      try {
        const hash = await _computeHash(val);

        if (hash === _AUTH_HASH) {
          const runtime = await _fetchEngine();
          if (!runtime || !runtime.crypto || !runtime.engine) {
            throw new Error('Engine failed to load. Please refresh and retry.');
          }
          const key = await runtime.crypto.deriveKey(val, _SYS_SALT);
          unlockStarted = true;
          await runtime.engine.unlock(key, _SYS_SALT, val);
          this.close();
          _failedCount = 0;
        } else {
          _failedCount++;
          if (err) {
            err.innerText = 'Invalid authorization credential.';
            err.style.display = 'block';
          }
          if (box) {
            box.classList.remove('shake');
            void box.offsetWidth;
            box.classList.add('shake');
          }
          if (input) {
            input.value = '';
            input.focus();
          }
          if (_failedCount >= 3) {
            location.reload();
          }
        }
      } catch (e) {
        console.error('Vault unlock error:', e);
        const msg = (e && e.message) ? e.message : 'Verification error. Please retry.';
        if (err) {
          err.innerText = msg;
          err.style.display = 'block';
        }
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Verify Credential';
        }
      } finally {
        if (btn && (!unlockStarted || err && err.style.display === 'block')) {
          btn.disabled = false;
          btn.innerText = 'Verify Credential';
        }
      }
    }

  };

  window._sysGateway = AdminGateway;

  
  window.addEventListener('click', (e) => {
    const pad = 60;
    if (window.innerWidth - e.clientX <= pad && window.innerHeight - e.clientY <= pad) {
      AdminGateway.open();
    }
  });

  let _logoClicks = 0;
  let _logoTimer = null;
  document.addEventListener('DOMContentLoaded', () => {
    const emblem = document.querySelector('.college-emblem');
    if (emblem) {
      emblem.addEventListener('click', () => {
        _logoClicks++;
        if (_logoTimer) clearTimeout(_logoTimer);
        if (_logoClicks >= 3) {
          _logoClicks = 0;
          AdminGateway.open();
        } else {
          _logoTimer = setTimeout(() => { _logoClicks = 0; }, 1000);
        }
      });
    }
  });

  
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      AdminGateway.open();
      return;
    }
    if (e.key === 'Escape' && _authPanel) {
      AdminGateway.close();
      return;
    }
  });

})();

