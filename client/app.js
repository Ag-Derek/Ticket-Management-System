// ---- API configuration ----
const API_BASE =
  window.location.hostname === 'localhost'
    ? 'http://localhost:4000'
    : 'https://ticket-management-system-9ssy.onrender.com';
    
document.addEventListener('DOMContentLoaded', function () {

  // Show only the pill for the current page (based on data-step); hide the rest
  var current = Number(document.body.dataset.step || 0);
  document.querySelectorAll('.step-pill').forEach(function (el) {
    var i = Number(el.dataset.step);
    var isCurrent = i === current;
    el.classList.toggle('active', isCurrent);
    el.classList.toggle('step-hidden', !isCurrent);
  });

  // Trigger entrance/float motion on the landing page's hero boxes
  var moEls = document.querySelectorAll('.mo');
  if (moEls.length) {
    moEls.forEach(function (el, i) {
      var delay = Number(el.dataset.delay || i * 120);
      setTimeout(function () { el.classList.add('mo-in'); }, delay);
    });
  }

  // Mints a PREFIX-2026-XXXXXX id, retrying against whatever record ids you pass in
  // so two tickets/agents/users minted in this browser can't collide. After 20 misses
  // (vanishingly unlikely with 900,000 possible suffixes) it falls back to a
  // Date.now()-derived suffix so this can never loop forever.
  function genUniqueId(prefix, existingIds) {
    for (var attempt = 0; attempt < 20; attempt++) {
      var id = prefix + '-2026-' + String(Math.floor(Math.random() * 900000) + 100000);
      if (existingIds.indexOf(id) === -1) return id;
    }
    return prefix + '-2026-' + String(Date.now()).slice(-6);
  }

  // Renders a read-only row of "📎 filename" chips (used for the attachments a
  // ticket was filed with, on the portal/agent/admin dashboards). No-op if the
  // container isn't on this page, or there's nothing to show.
  function renderAttachmentChips(container, names) {
    if (!container) return;
    container.innerHTML = '';
    (names || []).forEach(function (name) {
      var chip = document.createElement('span');
      chip.className = 'chat-attachment-chip';
      chip.textContent = '📎 ' + name;
      container.appendChild(chip);
    });
  }

  // Profile form validation + confirmation stub
  var profileForm = document.getElementById('profileForm');
  if (profileForm) {

    // Returning-user check: if a profile already exists on this device, show it
    // straight away instead of minting a brand-new USR id every time someone
    // passes through login -> profile.
    function showProfileStub(user, isReturning) {
      document.getElementById('stubId').textContent = user.id;
      document.getElementById('stubName').textContent = ', ' + user.name.trim().split(' ')[0];
      document.getElementById('stubLead').textContent = isReturning
        ? 'Welcome back — we found a saved profile on this device.'
        : 'Your details are saved.';
      profileForm.style.display = 'none';
      document.getElementById('stub').classList.add('show');
      var notYouLink = document.getElementById('notYouLink');
      notYouLink.style.display = isReturning ? 'block' : 'none';
    }

    var existingUser = null;
    try { existingUser = JSON.parse(localStorage.getItem('docketUser')); } catch (e) { existingUser = null; }
    if (existingUser && existingUser.id && existingUser.name) {
      showProfileStub(existingUser, true);
    }

    document.getElementById('notYouLink').addEventListener('click', function (e) {
      e.preventDefault();
      localStorage.removeItem('docketUser');
      document.getElementById('notYouLink').style.display = 'none';
      document.getElementById('stub').classList.remove('show');
      profileForm.style.display = '';
      document.getElementById('fullName').value = '';
      document.getElementById('email').value = '';
      document.getElementById('phone').value = '';
      document.getElementById('dept').value = '';
      document.getElementById('org').value = '';
    });

    var submitProfileBtn = document.getElementById('submitProfile');
    var submitProfileDefaultLabel = submitProfileBtn ? submitProfileBtn.textContent : '';

    // Surfaces a submission-time error near the email field (reusing the
    // f-email/err-email pattern used elsewhere, e.g. admin-login), falling
    // back to alert() if this page doesn't have an err-email element.
    function showProfileError(message) {
      var emailWrap = document.getElementById('f-email');
      var emailErr = document.getElementById('err-email');
      if (emailWrap) emailWrap.classList.add('invalid');
      if (emailErr) {
        emailErr.textContent = message;
      } else {
        alert(message);
      }
    }

    submitProfileBtn.addEventListener('click', function () {
      var name = document.getElementById('fullName');
      var email = document.getElementById('email');
      var phone = document.getElementById('phone');
      var dept = document.getElementById('dept');
      var org = document.getElementById('org');
      var valid = true;

      if (!name.value.trim()) {
        document.getElementById('f-name').classList.add('invalid');
        valid = false;
      } else {
        document.getElementById('f-name').classList.remove('invalid');
      }

      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      if (!emailOk) {
        document.getElementById('f-email').classList.add('invalid');
        valid = false;
      } else {
        document.getElementById('f-email').classList.remove('invalid');
      }

      if (!valid) return;

      submitProfileBtn.disabled = true;
      submitProfileBtn.textContent = 'Saving…';

      fetch(API_BASE + '/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name.value.trim(),
          email: email.value.trim(),
          phone: phone && phone.value.trim() ? phone.value.trim() : null,
          department: dept && dept.value.trim() ? dept.value.trim() : null,
          organization: org && org.value.trim() ? org.value.trim() : null
        })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw new Error(data.error || 'Unable to save your profile.');
            return data;
          });
        })
        .then(function (data) {
          // Normalize the API's `full_name` into the `name` field the rest
          // of app.js (ticket creation, portal, chat) already reads.
          var newUser = {
            id: data.id,
            name: data.full_name,
            email: data.email,
            phone: data.phone,
            department: data.department,
            organization: data.organization
          };
          document.getElementById('f-email').classList.remove('invalid');
          showProfileStub(newUser, data.returning === true);
          // Hand the profile off to the ticket page — the Render/SQLite
          // record is now the source of truth; this is just a session cache.
          localStorage.setItem('docketUser', JSON.stringify(newUser));
        })
        .catch(function (err) {
          console.error('Profile creation error:', err);
          showProfileError(err.message || 'Something went wrong. Please try again.');
        })
        .finally(function () {
          submitProfileBtn.disabled = false;
          submitProfileBtn.textContent = submitProfileDefaultLabel;
        });
    });
  }

  // ---- Agent directory: shared by agent sign-in, the agent dashboard's reassign
  // panel, and the admin console. Now backed by GET /api/agents on Render/SQLite —
  // the seeded five agents (Maya Owusu, Kwame Boateng, Ama Serwaa, Yaw Mensah, Efia
  // Asante) already live there via db/seed.js, so the client no longer seeds or
  // mints AGT ids itself.
  //
  // loadAgents() stays a *synchronous* read of a local cache — every existing call
  // site (reassign dropdown, admin assign dropdown, admin directory tab, stats
  // counts) reads it that way, several of them on every 4s poll tick. Hitting the
  // network that often would be wasteful, so refreshAgentDirectory() is what
  // actually talks to the API; call it once when a page needs the directory, then
  // read loadAgents() afterward. It's safe to call again any time (e.g. after
  // adding an agent) to pick up the latest list.
  var agentDirectoryCache = [];

  function loadAgents() {
    return agentDirectoryCache;
  }

  function normalizeAgent(a) {
    return { id: a.id, name: a.full_name, email: a.email, createdAt: a.created_at, createdBy: a.created_by };
  }

  function refreshAgentDirectory(onDone, onError) {
    fetch(API_BASE + '/api/agents')
      .then(function (response) {
        if (!response.ok) throw new Error('Unable to load the agent directory.');
        return response.json();
      })
      .then(function (agents) {
        agentDirectoryCache = agents.map(normalizeAgent);
        if (onDone) onDone(agentDirectoryCache);
      })
      .catch(function (err) {
        console.error('Agent directory load error:', err);
        if (onError) onError(err);
      });
  }

  // ---- Ticket data access (phase 1D-i) ----
  // Tickets now come from the API instead of the `docketTickets` localStorage
  // array. Server rows are snake_case and reference the requester/assignee by
  // id, while every render function in this file was written against the old
  // client-side shape — normalizeTicket() bridges the two, so nothing
  // downstream of it needed rewriting.
  //
  // Two things the API doesn't return yet, each noted at its use site below:
  //   - creation-time attachment filenames (only attachment_count comes back)
  //   - who escalated / who resolved (only the target and the text)
  // The requester's email now comes back on the ticket row itself
  // (requester_email, via tickets.js's LEFT JOIN to users) so there's no
  // need to fetch the whole users table just to reconstruct it client-side.

  // normalizeTicket() reads the agent cache, so it has to be warm before any
  // ticket is mapped. A failed directory load is non-fatal — tickets still
  // render, just with an id where a name would be — so the callback still runs.
  function withDirectories(onReady) {
    refreshAgentDirectory(onReady, onReady);
  }

  function agentNameForId(id) {
    if (!id) return null;
    var match = loadAgents().filter(function (a) { return a.id === id; })[0];
    return match ? match.name : id;
  }

  function normalizeTicket(row) {
    return {
      id: row.id,
      subject: row.subject,
      description: row.description,
      category: row.category,
      priority: row.priority,
      service: row.affected_service || '',
      team: row.assigned_team,
      sla: row.sla_summary,
      files: row.attachment_count || 0,
      // Only the count comes back from the API, not the filenames, so the
      // attachment *chips* stay hidden even when the count is non-zero. The
      // `Array.isArray` check means they light up on their own if tickets.js
      // later starts returning an `attachments` array.
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      userId: row.user_id,
      email: row.requester_email || row.user_id,
      status: row.status,
      assignedAgentId: row.assigned_agent_id || null,
      assignedAgent: agentNameForId(row.assigned_agent_id),
      createdAt: row.created_at,
      // `by` is blank because the API records what was written, not who wrote
      // it; the render sites below omit the attribution when it's empty.
      resolutionSummary: row.resolution_summary ? { text: row.resolution_summary, by: '' } : null,
      escalation: row.escalated_to ? { to: row.escalated_to, reason: row.escalation_reason || '', by: '' } : null,
      csat: row.csat_rating != null ? { score: row.csat_rating, comment: row.csat_comment || '' } : null
    };
  }

  // PATCH /api/tickets/:id/assign — pass a falsy agentId to send the ticket
  // back to the pool. The server owns the status side-effects here (claiming a
  // Created ticket makes it Assigned; unassigning anything that isn't
  // Resolved/Closed drops it back to Created), so the handlers below no longer
  // repeat that logic client-side — they render whatever comes back.
  function assignTicket(ticketId, agentId, onDone, onError) {
    fetch(API_BASE + '/api/tickets/' + encodeURIComponent(ticketId) + '/assign', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_agent_id: agentId || null })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Unable to update the assignment.');
          return data;
        });
      })
      .then(function (row) { onDone(normalizeTicket(row)); })
      .catch(function (err) {
        console.error('Assign error:', err);
        if (onError) onError(err);
      });
  }

  // Swap a server-updated ticket into an in-memory list, in place.
  function replaceTicketIn(list, updated) {
    var idx = list.findIndex(function (x) { return x.id === updated.id; });
    if (idx !== -1) list[idx] = updated;
    return list;
  }

  // The inline assign/reassign panels only had field-level `.err` slots, with
  // nothing for a failed request, so the error element is created on first use.
  function showPanelError(panel, message) {
    if (!panel) return;
    var box = panel.querySelector('.panel-error');
    if (!box) {
      box = document.createElement('p');
      box.className = 'err panel-error';
      box.style.display = 'block';
      box.style.marginBottom = '12px';
      panel.insertBefore(box, panel.firstChild);
    }
    box.textContent = message;
  }

  function clearPanelError(panel) {
    if (!panel) return;
    var box = panel.querySelector('.panel-error');
    if (box) box.remove();
  }

  // GET /api/tickets, optionally filtered — e.g. { user_id: 'USR-000001' } for
  // the customer portal, or no filter at all for the agent/admin queues.
  function fetchTickets(query, onDone, onError) {
    var qs = '';
    if (query) {
      var parts = [];
      Object.keys(query).forEach(function (k) {
        if (query[k]) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k]));
      });
      if (parts.length) qs = '?' + parts.join('&');
    }
    fetch(API_BASE + '/api/tickets' + qs)
      .then(function (response) {
        if (!response.ok) throw new Error('Unable to load tickets.');
        return response.json();
      })
      .then(function (rows) { onDone(rows.map(normalizeTicket)); })
      .catch(function (err) {
        console.error('Ticket load error:', err);
        if (onError) onError(err);
      });
  }

  // Agent self-sign-in (agent-login.html): the backend's find-or-create-by-email
  // behavior on POST /api/agents mirrors the app's existing "any password works"
  // demo design — there's no agent password on the backend to verify against, so
  // the client-side password check stays as-is (just requires something typed).
  function loginOrCreateAgentByEmail(email, fallbackName, onDone, onError) {
    fetch(API_BASE + '/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fallbackName, email: email, created_by: 'self-signup' })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
          return data;
        });
      })
      .then(function (data) {
        onDone(normalizeAgent(data));
      })
      .catch(onError);
  }

  // ---- Agent sign-in (agent-login.html): validation + confirmation stub ----
  var agentLoginForm = document.getElementById('agentLoginForm');
  if (agentLoginForm) {
    var submitAgentLoginBtn = document.getElementById('submitAgentLogin');
    var submitAgentLoginDefaultLabel = submitAgentLoginBtn.textContent;

    submitAgentLoginBtn.addEventListener('click', function () {
      var email = document.getElementById('agentEmail');
      var password = document.getElementById('agentPassword');
      var valid = true;

      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      if (!emailOk) {
        document.getElementById('f-agentEmail').classList.add('invalid');
        valid = false;
      } else {
        document.getElementById('f-agentEmail').classList.remove('invalid');
      }

      if (!password.value.trim()) {
        document.getElementById('f-agentPassword').classList.add('invalid');
        valid = false;
      } else {
        document.getElementById('f-agentPassword').classList.remove('invalid');
      }

      if (!valid) return;

      var namePart = email.value.trim().split('@')[0].replace(/[._]/g, ' ');
      var displayName = namePart.replace(/\b\w/g, function (c) { return c.toUpperCase(); });

      submitAgentLoginBtn.disabled = true;
      submitAgentLoginBtn.textContent = 'Signing in…';

      // Reuses an existing directory record if this email was set up from the admin
      // console (so that identity sticks), otherwise creates one on the fly — same
      // find-or-create contract as before, now backed by Render/SQLite.
      loginOrCreateAgentByEmail(email.value.trim(), displayName, function (record) {
        submitAgentLoginBtn.disabled = false;
        submitAgentLoginBtn.textContent = submitAgentLoginDefaultLabel;

        document.getElementById('agentStubId').textContent = record.id;
        document.getElementById('agentStubName').textContent = ', ' + record.name.split(' ')[0];
        agentLoginForm.style.display = 'none';
        document.getElementById('agentStub').classList.add('show');

        localStorage.setItem('docketAgent', JSON.stringify({
          id: record.id,
          name: record.name,
          email: record.email,
          keepSignedIn: document.getElementById('keepSignedIn').checked
        }));
      }, function (err) {
        console.error('Agent sign-in error:', err);
        submitAgentLoginBtn.disabled = false;
        submitAgentLoginBtn.textContent = submitAgentLoginDefaultLabel;
        document.getElementById('f-agentEmail').classList.add('invalid');
        alert(err.message || 'Unable to sign in. Please try again.');
      });
    });
  }
// ---- Admin sign-in (admin-login.html): single seeded super account, validation + confirmation stub ----
  var adminLoginForm = document.getElementById('adminLoginForm');
  if (adminLoginForm) {
    var submitAdminLoginBtn = document.getElementById('submitAdminLogin');
    var submitAdminLoginDefaultLabel = submitAdminLoginBtn.textContent;

    submitAdminLoginBtn.addEventListener('click', function () {
      var email = document.getElementById('adminEmail');
      var password = document.getElementById('adminPassword');
      var emailField = document.getElementById('f-adminEmail');
      var passwordField = document.getElementById('f-adminPassword');
      var emailErr = document.getElementById('err-adminEmail');
      var passwordErr = document.getElementById('err-adminPassword');

      // Reset to the default "required" messaging before re-checking
      emailErr.textContent = 'Enter your admin email address.';
      passwordErr.textContent = 'Enter your password.';

      var valid = true;
      if (!email.value.trim()) { emailField.classList.add('invalid'); valid = false; }
      else { emailField.classList.remove('invalid'); }

      if (!password.value.trim()) { passwordField.classList.add('invalid'); valid = false; }
      else { passwordField.classList.remove('invalid'); }

      if (!valid) return;

      submitAdminLoginBtn.disabled = true;
      submitAdminLoginBtn.textContent = 'Signing in…';

      // Real bcrypt check on Render now — this is the one login the backend
      // actually verifies (agents.js has no password at all; see Phase 1B).
      // Same generic "incorrect email or password" message either way, since
      // the server itself doesn't say which one was wrong.
      fetch(API_BASE + '/api/admins/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: password.value })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw new Error('Incorrect email or password.');
            return data;
          });
        })
        .then(function (data) {
          var admin = { id: data.id, name: data.full_name, email: data.email };

          document.getElementById('adminStubId').textContent = admin.id;
          document.getElementById('adminStubName').textContent = ', ' + admin.name.split(' ')[0];
          adminLoginForm.style.display = 'none';
          document.getElementById('adminStub').classList.add('show');

          localStorage.setItem('docketAdmin', JSON.stringify({
            id: admin.id,
            name: admin.name,
            email: admin.email,
            keepSignedIn: document.getElementById('adminKeepSignedIn').checked
          }));
        })
        .catch(function (err) {
          emailField.classList.add('invalid');
          passwordField.classList.add('invalid');
          emailErr.textContent = err.message || 'Incorrect email or password.';
          passwordErr.textContent = err.message || 'Incorrect email or password.';
        })
        .finally(function () {
          submitAdminLoginBtn.disabled = false;
          submitAdminLoginBtn.textContent = submitAdminLoginDefaultLabel;
        });
    });
  }

  // ---- Ticket creation (ticket.html): form + submitting animation, then hands off to portal.html ----
  var ticketForm = document.getElementById('ticketForm');
  if (ticketForm) {
    var user = null;
    try { user = JSON.parse(localStorage.getItem('docketUser')); } catch (e) { user = null; }
    if (user && document.getElementById('requesterLine')) {
      document.getElementById('requesterLine').textContent = 'Filing as ' + user.name + ' (' + user.id + ')';
    }

    var files = [];
    var fileInput = document.getElementById('attachments');
    var fileList = document.getElementById('fileList');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        Array.prototype.forEach.call(fileInput.files, function (f) { files.push(f.name); });
        fileInput.value = '';
        renderFiles();
      });
    }
    function renderFiles() {
      fileList.innerHTML = '';
      files.forEach(function (name, i) {
        var chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.innerHTML = '<span>' + name + '</span>';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Remove ' + name);
        btn.textContent = '✕';
        btn.addEventListener('click', function () { files.splice(i, 1); renderFiles(); });
        chip.appendChild(btn);
        fileList.appendChild(chip);
      });
    }

    // The category -> team and priority -> SLA tables used to live here and
    // are now owned by the server (see TEAM_BY_CATEGORY / SLA_BY_PRIORITY in
    // routes/tickets.js), so the client no longer keeps its own copies.

    document.getElementById('submitTicket').addEventListener('click', function () {
      var subject = document.getElementById('subject');
      var description = document.getElementById('description');
      var category = document.getElementById('category');
      var priority = document.getElementById('priority');
      var service = document.getElementById('service');
      var valid = true;

      [[subject, 'f-subject'], [description, 'f-description'], [category, 'f-category'], [priority, 'f-priority']]
        .forEach(function (pair) {
          var field = document.getElementById(pair[1]);
          if (!pair[0].value.trim()) { field.classList.add('invalid'); valid = false; }
          else { field.classList.remove('invalid'); }
        });

      if (!valid) return;

      ticketForm.style.display = 'none';
      var pipeline = document.getElementById('pipeline');
      pipeline.classList.add('show');

      var steps = document.querySelectorAll('.pipe-step');
      var delays = [0, 500, 1000, 1500, 2000];
      steps.forEach(function (s, i) {
        setTimeout(function () { s.classList.add('active'); }, delays[i] || i * 500);
      });

      // The POST fires immediately and the pipeline animation runs alongside
      // it; the redirect waits for whichever finishes last, so the row really
      // exists in the database before portal.html tries to read it back.
      var animationDone = false;
      var createdTicket = null;

      function maybeGoToPortal() {
        if (!animationDone || !createdTicket) return;
        // The portal used to be handed a whole ticket object through
        // `docketLatestTicket`; now it only needs to know which of the
        // tickets it fetches should open as the headline card.
        localStorage.setItem('docketLatestTicketId', createdTicket.id);
        window.location.href = 'portal.html';
      }

      // ticket.html has no error slot of its own — the form only had per-field
      // `.err` messages — so on failure we drop back to the form and put a
      // message above it rather than leaving the user on a stalled pipeline.
      function showSubmitError(message) {
        pipeline.classList.remove('show');
        ticketForm.style.display = '';
        var box = document.getElementById('ticketSubmitError');
        if (!box) {
          box = document.createElement('p');
          box.id = 'ticketSubmitError';
          box.className = 'err';
          box.style.display = 'block';
          box.style.marginBottom = '16px';
          ticketForm.insertBefore(box, document.getElementById('f-subject'));
        }
        box.textContent = message;
      }

      setTimeout(function () { animationDone = true; maybeGoToPortal(); }, 2600);

      fetch(API_BASE + '/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user ? user.id : null,
          subject: subject.value.trim(),
          description: description.value.trim(),
          category: category.value,
          priority: priority.value,
          affected_service: service && service.value.trim() ? service.value.trim() : null,
          attachments: files.slice()
        })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw new Error(data.error || 'Unable to create the ticket.');
            return data;
          });
        })
        .then(function (data) {
          createdTicket = data;
          maybeGoToPortal();
        })
        .catch(function (err) {
          console.error('Ticket create error:', err);
          showSubmitError(err.message || 'Unable to create the ticket. Please try again.');
        });
    });
  }

  // ---- Ticket portal (portal.html): profile sidebar + latest ticket + full, clickable history ----
  var dash = document.getElementById('dash');
  if (dash) {
    var portalUser = null;
    try { portalUser = JSON.parse(localStorage.getItem('docketUser')); } catch (e) { portalUser = null; }

    // Both of these start empty and are filled by the fetch at the bottom of
    // this block. `latestTicketId` is all ticket.html hands over now — the
    // ticket itself is read back from the API rather than passed through
    // localStorage.
    var latestTicketId = localStorage.getItem('docketLatestTicketId');
    var latest = null;
    var all = [];

    // Snapshot of each ticket's status as this tab currently knows it, so a
    // change made elsewhere (an agent updating status on their dashboard, or
    // this same customer with the portal open in a second tab) can be told
    // apart from a status this tab already displayed.
    var knownStatuses = {};

    function portalStatusClass(status) {
      if (status === 'Resolved') return 'status-resolved';
      if (status === 'Closed') return 'status-closed';
      if (status === 'Reopened') return 'status-reopened';
      if (status === 'In Progress') return 'status-progress';
      if (status === 'Waiting') return 'status-waiting';
      if (status === 'Escalated') return 'status-escalated';
      return '';
    }

    // Phase 1D-i moved reads to the API; the matching write endpoints land in
    // 1D-iii (confirm fix / reopen) and 1D-iv (CSAT). Until then this keeps the
    // page's in-memory copies in sync so the UI still updates on click, but the
    // change is NOT persisted anywhere and will not survive a reload.
    function persistPortalTicket(t) {
      var idx = all.findIndex(function (x) { return x.id === t.id; });
      if (idx !== -1) all[idx] = t;
      if (latest && latest.id === t.id) latest = t;
    }

    // Profile sidebar
    var profileSidebar = document.getElementById('profileSidebar');
    if (profileSidebar) {
      if (portalUser && portalUser.name) {
        var initials = portalUser.name.trim().split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase();
        document.getElementById('profileInitials').textContent = initials || '?';
        document.getElementById('profileName').textContent = portalUser.name;
        document.getElementById('profileId').textContent = portalUser.id;
        document.getElementById('profileEmail').textContent = portalUser.email;
        // Filled in once the fetch below resolves.
        document.getElementById('profileTicketCount').textContent = '—';
      } else {
        profileSidebar.style.display = 'none';
      }
    }

    // Loads a ticket's full details into the dashboard card and highlights its row
    var currentTicketId = null;
    function showTicketDetails(t) {
      currentTicketId = t.id;
      document.getElementById('dashId').textContent = t.id;
      document.getElementById('dashSubject').textContent = t.subject;
      document.getElementById('dashDescription').textContent = t.description ? t.description : 'No description provided.';
      document.getElementById('dashCategory').textContent = t.category;
      document.getElementById('dashPriority').textContent = t.priority;
      document.getElementById('dashTeam').textContent = t.team;
      document.getElementById('dashSla').textContent = t.sla;
      document.getElementById('dashFiles').textContent = t.files ? t.files + ' attached' : 'None';
      document.getElementById('dashEmail').textContent = t.email;
      document.getElementById('dashAgent').textContent = t.assignedAgent || 'Unassigned';

      var dashAttBlock = document.getElementById('dashAttachmentsBlock');
      if (dashAttBlock) {
        if (t.attachments && t.attachments.length) {
          renderAttachmentChips(document.getElementById('dashAttachmentsList'), t.attachments);
          dashAttBlock.style.display = '';
        } else {
          dashAttBlock.style.display = 'none';
        }
      }

      var serviceBox = document.getElementById('dashServiceBox');
      if (serviceBox) {
        if (t.service) {
          document.getElementById('dashService').textContent = t.service;
          serviceBox.style.display = '';
        } else {
          serviceBox.style.display = 'none';
        }
      }

      var statusBadge = document.getElementById('dashStatusBadge');
      statusBadge.textContent = t.status || 'Assigned';
      statusBadge.className = 'status-badge ' + portalStatusClass(t.status);

      var messageAgentBtn = document.getElementById('messageAgentBtn');
      if (messageAgentBtn) messageAgentBtn.setAttribute('href', 'ticket-chat.html?ticket=' + encodeURIComponent(t.id) + '&role=customer');

      // Confirm fix / reopen only apply while a ticket is sitting in "Resolved",
      // waiting on the customer to say whether the fix actually worked.
      var resolutionRow = document.getElementById('resolutionRow');
      var notifyBanner = document.getElementById('dashNotifyBanner');
      if (resolutionRow) {
        resolutionRow.style.display = t.status === 'Resolved' ? 'flex' : 'none';
      }
      if (notifyBanner) {
        var bannerText = notifyBanner.querySelector('p');
        if (t.status === 'Closed') {
          bannerText.innerHTML = 'You confirmed the fix for <strong id="dashEmail">' + t.email + '</strong> — this ticket is closed.';
        } else if (t.status === 'Reopened') {
          bannerText.innerHTML = 'You reopened this ticket — <strong id="dashEmail">' + t.email + '</strong> has been notified.';
        } else {
          bannerText.innerHTML = 'Confirmation sent to <strong id="dashEmail">' + t.email + '</strong> via the notification service.';
        }
      }

      // Show what the agent said fixed the issue, once they've resolved it —
      // this stays visible even if the ticket later gets reopened.
      var resSummaryBlock = document.getElementById('dashResolutionSummaryBlock');
      var resSummaryText = document.getElementById('dashResolutionSummaryText');
      if (resSummaryBlock && resSummaryText) {
        if (t.resolutionSummary) {
          resSummaryText.textContent = t.resolutionSummary.text;
          resSummaryBlock.style.display = 'block';
        } else {
          resSummaryBlock.style.display = 'none';
        }
      }

      // CSAT: prompt for a rating once a ticket is Closed and unrated; show the
      // submitted rating (read-only) once one exists.
      var csatPanel = document.getElementById('csatPanel');
      var csatDone = document.getElementById('csatDone');
      if (csatPanel && csatDone) {
        if (t.status === 'Closed' && !t.csat) {
          csatPanel.style.display = 'block';
          csatDone.style.display = 'none';
          resetCsatForm();
        } else if (t.status === 'Closed' && t.csat) {
          csatPanel.style.display = 'none';
          csatDone.style.display = 'flex';
          renderCsatDone(t.csat);
        } else {
          csatPanel.style.display = 'none';
          csatDone.style.display = 'none';
        }
      }

      // Re-render the (filtered) history list so status changes and the
      // active-row highlight both stay in sync with what's currently shown.
      renderHistoryList();
    }

    var confirmFixBtn = document.getElementById('confirmFixBtn');
    if (confirmFixBtn) {
      confirmFixBtn.addEventListener('click', function () {
        var t = all.filter(function (x) { return x.id === currentTicketId; })[0];
        if (!t) return;
        t.status = 'Closed';
        persistPortalTicket(t);
        showTicketDetails(t);
      });
    }

    var reopenBtn = document.getElementById('reopenBtn');
    if (reopenBtn) {
      reopenBtn.addEventListener('click', function () {
        var t = all.filter(function (x) { return x.id === currentTicketId; })[0];
        if (!t) return;
        t.status = 'Reopened';
        persistPortalTicket(t);
        showTicketDetails(t);
      });
    }

    // ---- CSAT rating (shown on a Closed ticket until the customer rates it) ----
    var csatSelected = 0;
    var csatStarEls = document.querySelectorAll('#csatStars .csat-star');
    var csatSubmitBtn = document.getElementById('csatSubmitBtn');
    var csatCommentEl = document.getElementById('csatComment');

    function paintCsatStars(upTo) {
      csatStarEls.forEach(function (star) {
        star.classList.toggle('active', Number(star.dataset.value) <= upTo);
      });
    }

    function resetCsatForm() {
      csatSelected = 0;
      paintCsatStars(0);
      if (csatSubmitBtn) csatSubmitBtn.disabled = true;
      if (csatCommentEl) csatCommentEl.value = '';
    }

    function renderCsatDone(csat) {
      var doneStars = document.getElementById('csatDoneStars');
      var doneText = document.getElementById('csatDoneText');
      if (doneStars) {
        doneStars.innerHTML = '';
        for (var i = 1; i <= 5; i++) {
          var s = document.createElement('span');
          s.className = 'csat-star' + (i <= csat.score ? ' active' : '');
          s.textContent = '★';
          doneStars.appendChild(s);
        }
      }
      if (doneText) {
        doneText.innerHTML = 'You rated this ticket <strong>' + csat.score + '/5</strong>' +
          (csat.comment ? ' — thanks for the note!' : ' — thanks for the feedback!');
      }
    }

    csatStarEls.forEach(function (star) {
      star.addEventListener('click', function () {
        csatSelected = Number(star.dataset.value);
        paintCsatStars(csatSelected);
        if (csatSubmitBtn) csatSubmitBtn.disabled = false;
      });
      star.addEventListener('mouseenter', function () { paintCsatStars(Number(star.dataset.value)); });
      star.addEventListener('mouseleave', function () { paintCsatStars(csatSelected); });
    });

    if (csatSubmitBtn) {
      csatSubmitBtn.addEventListener('click', function () {
        if (!csatSelected) return;
        var t = all.filter(function (x) { return x.id === currentTicketId; })[0];
        if (!t) return;
        t.csat = { score: csatSelected, comment: (csatCommentEl ? csatCommentEl.value.trim() : ''), submittedAt: new Date().toISOString() };
        persistPortalTicket(t);
        showTicketDetails(t);
      });
    }

    // FR-15: search + status/category filters over "Your tickets" — previously
    // a flat, unfiltered dump of every ticket, unlike the agent/admin queues
    // which both already had search + filters over the same kind of list.
    var historySection = document.getElementById('ticketHistory');
    var historyListEl = document.getElementById('historyList');
    var portalQueueSearchInput = document.getElementById('portalQueueSearchInput');
    var portalQueueStatusFilter = document.getElementById('portalQueueStatusFilter');
    var portalQueueCategoryFilter = document.getElementById('portalQueueCategoryFilter');
    var portalQueueClearFilters = document.getElementById('portalQueueClearFilters');
    var portalSearchQuery = '', portalStatusFilter = '', portalCategoryFilter = '';

    function renderHistoryList() {
      if (!historySection || !historyListEl) return;
      if (!all.length) { historySection.style.display = 'none'; return; }
      historySection.style.display = 'block';

      var q = portalSearchQuery.trim().toLowerCase();
      var filtered = all.filter(function (t) {
        if (portalStatusFilter && t.status !== portalStatusFilter) return false;
        if (portalCategoryFilter && t.category !== portalCategoryFilter) return false;
        if (q) {
          var haystack = (t.id + ' ' + t.subject + ' ' + (t.category || '')).toLowerCase();
          if (haystack.indexOf(q) === -1) return false;
        }
        return true;
      });

      historyListEl.innerHTML = '';
      if (!filtered.length) {
        historyListEl.innerHTML = '<p class="queue-no-results">No tickets match your search or filters.</p>';
        return;
      }

      filtered.forEach(function (t) {
        var row = document.createElement('div');
        row.className = 'history-row ' + portalStatusClass(t.status) + (t.id === currentTicketId ? ' active' : '');
        row.dataset.ticketId = t.id;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', 'View details for ' + t.subject);
        row.innerHTML =
          '<div class="history-main">' +
            '<p class="history-id">' + t.id + '</p>' +
            '<p class="history-subject">' + t.subject + '</p>' +
          '</div>' +
          '<div class="history-meta">' +
            '<span class="history-chip">' + t.category + '</span>' +
            '<span class="history-chip">' + t.priority + '</span>' +
            '<span class="history-chip">' + t.team + '</span>' +
            '<span class="history-status">' + t.status + '</span>' +
          '</div>';
        row.addEventListener('click', function () { showTicketDetails(t); });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTicketDetails(t); }
        });
        historyListEl.appendChild(row);
      });
    }

    if (portalQueueSearchInput) {
      portalQueueSearchInput.addEventListener('input', function () {
        portalSearchQuery = portalQueueSearchInput.value;
        renderHistoryList();
      });
    }
    if (portalQueueStatusFilter) {
      portalQueueStatusFilter.addEventListener('change', function () {
        portalStatusFilter = portalQueueStatusFilter.value;
        renderHistoryList();
      });
    }
    if (portalQueueCategoryFilter) {
      portalQueueCategoryFilter.addEventListener('change', function () {
        portalCategoryFilter = portalQueueCategoryFilter.value;
        renderHistoryList();
      });
    }
    if (portalQueueClearFilters) {
      portalQueueClearFilters.addEventListener('click', function () {
        portalSearchQuery = ''; portalStatusFilter = ''; portalCategoryFilter = '';
        if (portalQueueSearchInput) portalQueueSearchInput.value = '';
        if (portalQueueStatusFilter) portalQueueStatusFilter.value = '';
        if (portalQueueCategoryFilter) portalQueueCategoryFilter.value = '';
        renderHistoryList();
      });
    }

    // Renders whatever `all` currently holds. Called once the initial fetch
    // resolves (and on failure, which lands on the empty state).
    function bootstrapPortal() {
      var empty = document.getElementById('portalEmpty');
      if (!all.length) {
        dash.style.display = 'none';
        if (empty) empty.style.display = 'block';
        renderHistoryList();
        return;
      }
      if (empty) empty.style.display = 'none';
      dash.style.display = '';
      // Prefer the ticket just created; otherwise the newest, since the API
      // already returns them ordered by created_at DESC.
      latest = all.filter(function (t) { return t.id === latestTicketId; })[0] || all[0];
      showTicketDetails(latest);
      renderHistoryList();
    }

    withDirectories(function () {
      if (!portalUser || !portalUser.id) { bootstrapPortal(); return; }
      fetchTickets({ user_id: portalUser.id }, function (rows) {
        all = rows;
        all.forEach(function (t) { knownStatuses[t.id] = t.status; });
        var countEl = document.getElementById('profileTicketCount');
        if (countEl) countEl.textContent = all.length;
        bootstrapPortal();
      }, function () {
        bootstrapPortal();
      });
    });

    // ---- FR-4: live notifications on status change ----
    // Status changes happen on the agent dashboard (a different tab/window),
    // so this tab needs to notice the shared localStorage record changing
    // and refresh in place instead of requiring the customer to reload.

    function showStatusToast(ticket, fromStatus, toStatus) {
      var wrap = document.getElementById('statusToastWrap');
      if (!wrap) return;
      var toast = document.createElement('div');
      toast.className = 'status-toast';
      toast.innerHTML =
        '<div class="ic">✓</div>' +
        '<div class="toast-body">' +
          '<p class="toast-title">' + ticket.id + '</p>' +
          '<p class="toast-sub">' + (ticket.subject ? ticket.subject + ' — ' : '') +
            'now <strong>' + toStatus + '</strong> (was ' + (fromStatus || 'Created') + ')</p>' +
        '</div>' +
        '<button type="button" class="toast-close" aria-label="Dismiss notification">✕</button>';
      wrap.appendChild(toast);

      function dismiss() {
        toast.classList.add('leaving');
        setTimeout(function () { toast.remove(); }, 280);
      }
      toast.querySelector('.toast-close').addEventListener('click', dismiss);
      setTimeout(dismiss, 6000);
    }

    function pulseStatusBadge() {
      var badge = document.getElementById('dashStatusBadge');
      if (!badge) return;
      badge.classList.remove('pulse');
      void badge.offsetWidth; // restart the animation if it's already mid-pulse
      badge.classList.add('pulse');
    }

    // Takes a freshly fetched (already normalized) ticket list, diffs it
    // against what this tab last knew, refreshes the dashboard/history in
    // place, and toasts every ticket whose status actually moved.
    function applyRemoteTicketUpdate(updated) {
      if (!updated || !updated.length) return;

      var changedList = [];
      updated.forEach(function (t) {
        var prevStatus = knownStatuses[t.id];
        if (prevStatus !== undefined && prevStatus !== t.status) {
          changedList.push({ ticket: t, from: prevStatus, to: t.status });
        }
        knownStatuses[t.id] = t.status;
      });

      if (!changedList.length) return;

      all = updated;
      if (latest) {
        var freshLatest = all.filter(function (x) { return x.id === latest.id; })[0];
        if (freshLatest) latest = freshLatest;
      }
      // Re-showing the currently open ticket also re-syncs every history row's
      // status pill/class against the fresh `all` array (see showTicketDetails).
      if (currentTicketId) {
        var openTicket = all.filter(function (x) { return x.id === currentTicketId; })[0];
        if (openTicket) showTicketDetails(openTicket);
      }

      changedList.forEach(function (c) {
        showStatusToast(c.ticket, c.from, c.to);
        if (c.ticket.id === currentTicketId) pulseStatusBadge();
      });
    }

    // The `storage` listener that used to drive this is gone: tickets no longer
    // live in localStorage, so that event will never fire for them again. The
    // poll that was previously just a fallback is now the sole live-update
    // path — it refetches this user's tickets and feeds the same diff logic,
    // which stays a no-op until a status actually moves.
    setInterval(function () {
      if (!portalUser || !portalUser.id) return;
      fetchTickets({ user_id: portalUser.id }, applyRemoteTicketUpdate);
    }, 4000);
  }

  // ---- Agent queue (agent-dashboard.html): stats + filterable list + ticket actions ----
  var agentQueue = document.getElementById('agentQueue');
  if (agentQueue) {
    var agent = null;
    try { agent = JSON.parse(localStorage.getItem('docketAgent')); } catch (e) { agent = null; }
    if (!agent) {
      window.location.href = 'agent-login.html';
      return;
    }

    // Agent profile (sidebar + topbar chip)
    var agentInitials = agent.name.trim().split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase() || '?';
    document.getElementById('agentInitials').textContent = agentInitials;
    document.getElementById('agentName').textContent = agent.name;
    document.getElementById('agentId').textContent = agent.id;
    document.getElementById('agentEmailDisplay').textContent = agent.email;
    document.getElementById('agentChipInitials').textContent = agentInitials;
    document.getElementById('agentChipName').textContent = agent.name.split(' ')[0];

    document.getElementById('agentLogoutBtn').addEventListener('click', function () {
      localStorage.removeItem('docketAgent');
      window.location.href = 'agent-login.html';
    });

    // Tickets are fetched from the API at the bottom of this block; the old
    // localStorage read (and the backfill defaults it needed for records
    // predating the status/assignment fields) is gone, since every row now
    // comes out of the database with those columns already populated.
    var tickets = [];

    // Was: write the whole array back to `docketTickets`. Assignment now goes
    // through PATCH /api/tickets/:id/assign (1D-ii); the remaining callers are
    // the status moves, which land in 1D-iii. Until then those still mutate
    // their in-memory ticket and re-render, so the queue updates on screen but
    // the change is NOT saved and won't survive a reload.
    function persistTickets() { /* no-op until 1D-iii */ }

    var currentFilter = 'All';
    var searchQuery = '';
    var statusFilter = '';
    var categoryFilter = '';
    var dateFilter = '';
    var selectedId = null; // set once the fetch below resolves

    function statusClass(status) {
      if (status === 'Resolved') return 'status-resolved';
      if (status === 'Closed') return 'status-closed';
      if (status === 'Reopened') return 'status-reopened';
      if (status === 'In Progress') return 'status-progress';
      if (status === 'Waiting') return 'status-waiting';
      if (status === 'Escalated') return 'status-escalated';
      return '';
    }

    // Closed tickets are done, same as Resolved, for queue-health purposes.
    // Reopened tickets are back in the open pile until an agent resolves them again.
    function isOpenStatus(status) { return status !== 'Resolved' && status !== 'Closed'; }

    // ---- Ticket status state machine ----
    // Each key is a status an agent can act on; the value lists every status
    // it's allowed to move to next, with the button label to show for that move.
    // Anything not listed here (e.g. from Resolved/Closed) has no agent-facing
    // action — those only change via the customer's confirm/reopen on the portal.
    var STATUS_TRANSITIONS = {
      // No entry for 'Created': a ticket must be assigned to an agent (via
      // "Assign to me") before any status action becomes available.
      'Assigned': [
        { to: 'In Progress', label: 'Start progress' }
      ],
      'In Progress': [
        { to: 'Waiting', label: 'Mark waiting on customer' },
        { to: 'Escalated', label: 'Escalate' },
        { to: 'Resolved', label: 'Mark resolved' }
      ],
      'Waiting': [
        { to: 'In Progress', label: 'Resume progress' }
      ],
      'Escalated': [
        { to: 'In Progress', label: 'Resume progress' }
      ],
      'Reopened': [
        { to: 'In Progress', label: 'Resume progress' }
      ]
    };

    // True only if `to` is one of the moves STATUS_TRANSITIONS allows from `from`.
    // This is the single gate everything else in the agent view goes through, so
    // there's no path in the UI that can set a status out of sequence.
    function canTransition(from, to) {
      var moves = STATUS_TRANSITIONS[from] || [];
      return moves.some(function (m) { return m.to === to; });
    }

    function changeStatus(t, toStatus) {
      if (!isMine(t)) return false;
      if (!canTransition(t.status, toStatus)) return false;
      t.status = toStatus;
      persistTickets();
      renderStats(); renderDetail(); renderList();
      return true;
    }

    // Only the agent a ticket is currently assigned to may move its status,
    // escalate it, or resolve it. Everyone else gets a locked notice instead
    // of live controls — "Assign to me" (or the owner's "Reassign…") is the
    // only way in.
    function isMine(t) {
      // Compared by id rather than name now that the API supplies one — two
      // agents sharing a display name would otherwise both "own" the ticket.
      return !!t.assignedAgentId && t.assignedAgentId === agent.id;
    }

    // Handing a ticket to a specific agent is allowed either as a genuine
    // reassignment (you currently own it) or as a direct claim-for-someone-
    // else on a ticket nobody has touched yet — so a teammate's ticket
    // doesn't have to be "assigned to me" first just to hand it over.
    function canReassign(t) {
      // Resolved means the ticket is sitting with the customer awaiting their
      // confirm-fix/reopen decision — swapping the owning agent mid-confirmation
      // doesn't make sense, so it's locked the same as Closed.
      if (t.status === 'Closed' || t.status === 'Resolved') return false;
      return isMine(t) || !t.assignedAgentId;
    }

    function renderStatusActions(t) {
      var wrap = document.getElementById('statusActions');
      wrap.innerHTML = '';

      if (!isMine(t)) {
        var lock = document.createElement('span');
        lock.className = 'history-status';
        lock.textContent = t.assignedAgent
          ? 'Assigned to ' + t.assignedAgent + ' — assign to yourself to act on it'
          : 'Unassigned — assign to yourself to act on it';
        wrap.appendChild(lock);
        return;
      }

      var moves = STATUS_TRANSITIONS[t.status] || [];
      moves.forEach(function (m) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-ghost btn-inline';
        btn.textContent = m.label;
        // Escalating needs a target + reason first, and resolving needs a
        // summary first, so open the relevant panel instead of transitioning
        // straight away like every other status move does.
        if (m.to === 'Escalated') {
          btn.addEventListener('click', function () { openEscalatePanel(t); });
        } else if (m.to === 'Resolved') {
          btn.addEventListener('click', function () { openResolvePanel(t); });
        } else {
          btn.addEventListener('click', function () { changeStatus(t, m.to); });
        }
        wrap.appendChild(btn);
      });
      if (!moves.length) {
        var note = document.createElement('span');
        note.className = 'history-status';
        note.textContent = t.status === 'Resolved' ? 'Awaiting customer' : (t.status === 'Closed' ? 'Closed' : '');
        if (note.textContent) wrap.appendChild(note);
      }
    }

    // ---- Reassign / escalate ----
    // The reassign select is built from the shared agent directory (GET
    // /api/agents) at open time, so an agent added from the admin console shows
    // up here with no change to this file. It replaced AGENT_ROSTER, a
    // names-only copy with its own fetch — PATCH /assign takes an agent id, so
    // the select needs the full record. The directory has long since loaded by
    // the time a click opens the panel.
    var ESCALATION_TARGETS = ['Tier 2 Support', 'Team Lead', 'Engineering', 'Network Operations Center'];

    function formatNoteTime(d) {
      var h = d.getHours(); var m = d.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    }

    // Drops an internal-only note into the ticket's existing chat thread, so
    // reassignments and escalations leave the same kind of trail agents already
    // see for internal comments — no separate history UI needed.
    function addInternalNote(ticketId, text) {
      var chatKey = 'docketChat:' + ticketId;
      var msgs = [];
      try { msgs = JSON.parse(localStorage.getItem(chatKey)) || []; } catch (e) { msgs = []; }
      msgs.push({ from: 'agent', name: agent.name, text: text, time: formatNoteTime(new Date()), visibility: 'internal' });
      localStorage.setItem(chatKey, JSON.stringify(msgs));
    }

    var reassignPanel = document.getElementById('reassignPanel');
    var reassignSelect = document.getElementById('reassignSelect');
    var reassignNote = document.getElementById('reassignNote');
    var escalatePanel = document.getElementById('escalatePanel');
    var escalateSelect = document.getElementById('escalateSelect');
    var escalateReason = document.getElementById('escalateReason');
    var resolvePanel = document.getElementById('resolvePanel');
    var resolveSummaryField = document.getElementById('f-resolveSummary');
    var resolveSummaryInput = document.getElementById('resolveSummary');

    function closePanels() {
      reassignPanel.style.display = 'none';
      escalatePanel.style.display = 'none';
      if (resolvePanel) resolvePanel.style.display = 'none';
    }

    function openReassignPanel(t) {
      escalatePanel.style.display = 'none';
      if (resolvePanel) resolvePanel.style.display = 'none';
      reassignSelect.innerHTML = '';
      var unassignedOpt = document.createElement('option');
      unassignedOpt.value = '';
      unassignedOpt.textContent = 'Unassigned';
      if (!t.assignedAgent) unassignedOpt.selected = true;
      reassignSelect.appendChild(unassignedOpt);
      // Option values are agent ids — that's what PATCH /assign takes — with
      // the name shown as the label.
      loadAgents().filter(function (a) { return a.id !== agent.id; }).forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.name;
        if (a.id === t.assignedAgentId) opt.selected = true;
        reassignSelect.appendChild(opt);
      });
      reassignNote.value = '';
      clearPanelError(reassignPanel);
      var prompt = document.getElementById('reassignPrompt');
      if (prompt) prompt.textContent = t.assignedAgent ? 'Hand this ticket to another agent' : 'Assign this unclaimed ticket to an agent';
      reassignPanel.style.display = 'block';
    }

    function openEscalatePanel(t) {
      reassignPanel.style.display = 'none';
      if (resolvePanel) resolvePanel.style.display = 'none';
      escalateSelect.innerHTML = '';
      ESCALATION_TARGETS.forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        escalateSelect.appendChild(opt);
      });
      escalateReason.value = '';
      escalatePanel.style.display = 'block';
    }

    function openResolvePanel(t) {
      if (!resolvePanel) return;
      reassignPanel.style.display = 'none';
      escalatePanel.style.display = 'none';
      resolveSummaryInput.value = '';
      if (resolveSummaryField) resolveSummaryField.classList.remove('invalid');
      resolvePanel.style.display = 'block';
    }

    document.getElementById('reassignBtn').addEventListener('click', function () {
      var t = tickets.filter(function (x) { return x.id === selectedId; })[0];
      if (!t) return;
      if (reassignPanel.style.display === 'block') { closePanels(); return; }
      openReassignPanel(t);
    });
    document.getElementById('reassignCancelBtn').addEventListener('click', closePanels);
    document.getElementById('reassignConfirmBtn').addEventListener('click', function () {
      var t = tickets.filter(function (x) { return x.id === selectedId; })[0];
      if (!t || !canReassign(t)) { closePanels(); return; }
      var toId = reassignSelect.value; // '' means the Unassigned option was picked
      if (toId === (t.assignedAgentId || '')) { closePanels(); return; }

      // Captured before the request so the note reads correctly regardless of
      // what the server hands back.
      var wasUnassigned = !t.assignedAgentId;
      var from = t.assignedAgent || 'Unassigned';
      var toName = toId ? agentNameForId(toId) : null;
      var note = reassignNote.value.trim();
      var confirmBtn = document.getElementById('reassignConfirmBtn');

      clearPanelError(reassignPanel);
      confirmBtn.disabled = true;
      assignTicket(t.id, toId, function (updated) {
        confirmBtn.disabled = false;
        replaceTicketIn(tickets, updated);
        agentKnownSignature[updated.id] = updated.status + '|' + (updated.assignedAgent || '');
        var noteText = toName
          ? (wasUnassigned ? 'Assigned to ' + toName : 'Reassigned from ' + from + ' to ' + toName)
          : 'Unassigned (was ' + from + ')';
        // Still a localStorage internal note until 1D-v moves comments.
        addInternalNote(updated.id, noteText + (note ? ' — ' + note : '.'));
        closePanels();
        renderStats(); renderDetail(); renderList();
      }, function (err) {
        confirmBtn.disabled = false;
        showPanelError(reassignPanel, err.message || 'Unable to update the assignment.');
      });
    });

    document.getElementById('escalateCancelBtn').addEventListener('click', closePanels);
    document.getElementById('escalateConfirmBtn').addEventListener('click', function () {
      var t = tickets.filter(function (x) { return x.id === selectedId; })[0];
      if (!t || !isMine(t)) { closePanels(); return; }
      var to = escalateSelect.value;
      var reason = escalateReason.value.trim();
      if (!to || !reason) return;
      if (!canTransition(t.status, 'Escalated')) { closePanels(); return; }
      t.status = 'Escalated';
      t.escalation = { to: to, reason: reason, by: agent.name, at: new Date().toISOString() };
      persistTickets();
      addInternalNote(t.id, 'Escalated to ' + to + ' — ' + reason);
      closePanels();
      renderStats(); renderDetail(); renderList();
    });

    // Resolving requires a summary — this is the only path that can set a
    // ticket to Resolved, so there's no way to skip leaving one.
    var resolveCancelBtn = document.getElementById('resolveCancelBtn');
    var resolveConfirmBtn = document.getElementById('resolveConfirmBtn');
    if (resolveCancelBtn) resolveCancelBtn.addEventListener('click', closePanels);
    if (resolveConfirmBtn) {
      resolveConfirmBtn.addEventListener('click', function () {
        var t = tickets.filter(function (x) { return x.id === selectedId; })[0];
        if (!t || !isMine(t)) { closePanels(); return; }
        var summary = resolveSummaryInput.value.trim();
        if (!summary) {
          if (resolveSummaryField) resolveSummaryField.classList.add('invalid');
          resolveSummaryInput.focus();
          return;
        }
        if (resolveSummaryField) resolveSummaryField.classList.remove('invalid');
        if (!canTransition(t.status, 'Resolved')) { closePanels(); return; }
        t.status = 'Resolved';
        t.resolutionSummary = { text: summary, by: agent.name, at: new Date().toISOString() };
        persistTickets();
        addInternalNote(t.id, 'Marked resolved — ' + summary);
        closePanels();
        renderStats(); renderDetail(); renderList();
      });
    }

    function renderStats() {
      var open = tickets.filter(function (t) { return isOpenStatus(t.status); }).length;
      var critical = tickets.filter(function (t) { return t.priority === 'Critical' && isOpenStatus(t.status); }).length;
      var unassigned = tickets.filter(function (t) { return !t.assignedAgent && isOpenStatus(t.status); }).length;
      var resolved = tickets.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;
      var mine = tickets.filter(isMine).length;

      document.getElementById('statOpen').textContent = open;
      document.getElementById('statCritical').textContent = critical;
      document.getElementById('statUnassigned').textContent = unassigned;
      document.getElementById('statResolved').textContent = resolved;
      document.getElementById('agentMineCount').textContent = mine;
    }

    function renderDetail() {
      var dash = document.getElementById('agentDash');
      var t = tickets.filter(function (x) { return x.id === selectedId; })[0];

      if (!t) {
        dash.style.display = 'none';
        return;
      }
      dash.style.display = 'block';
      closePanels();

      document.getElementById('dashId').textContent = t.id;
      document.getElementById('dashSubject').textContent = t.subject;
      document.getElementById('dashDescription').textContent = t.description ? t.description : 'No description provided.';
      document.getElementById('dashCategory').textContent = t.category;
      document.getElementById('dashPriority').textContent = t.priority;
      document.getElementById('dashTeam').textContent = t.team;
      document.getElementById('dashSla').textContent = t.sla;
      document.getElementById('dashFiles').textContent = t.files ? t.files + ' attached' : 'None';
      document.getElementById('dashEmail').textContent = t.email;
      document.getElementById('dashAgent').textContent = t.assignedAgent || 'Unassigned';

      var dashAttBlock = document.getElementById('dashAttachmentsBlock');
      if (dashAttBlock) {
        if (t.attachments && t.attachments.length) {
          renderAttachmentChips(document.getElementById('dashAttachmentsList'), t.attachments);
          dashAttBlock.style.display = '';
        } else {
          dashAttBlock.style.display = 'none';
        }
      }

      var serviceBox = document.getElementById('dashServiceBox');
      if (serviceBox) {
        if (t.service) {
          document.getElementById('dashService').textContent = t.service;
          serviceBox.style.display = '';
        } else {
          serviceBox.style.display = 'none';
        }
      }

      var badge = document.getElementById('dashStatusBadge');
      badge.textContent = t.status;
      badge.className = 'status-badge ' + statusClass(t.status);

      var assignBtn = document.getElementById('assignToMeBtn');
      assignBtn.disabled = isMine(t);
      assignBtn.textContent = isMine(t) ? 'Assigned to you' : 'Assign to me';
      var reassignBtn = document.getElementById('reassignBtn');
      reassignBtn.disabled = !canReassign(t);
      reassignBtn.textContent = t.assignedAgentId ? 'Reassign…' : 'Assign to…';
      renderStatusActions(t);
      document.getElementById('messageCustomerBtn').setAttribute('href', 'ticket-chat.html?ticket=' + encodeURIComponent(t.id) + '&role=agent');

      // Surface whether the customer has confirmed the fix or reopened the ticket.
      var resBanner = document.getElementById('dashResolutionBanner');
      var resText = document.getElementById('dashResolutionText');
      if (resBanner && resText) {
        if (t.status === 'Closed') {
          resBanner.style.display = 'flex';
          resText.innerHTML = 'Customer <strong>confirmed the fix</strong> — ticket closed.';
        } else if (t.status === 'Reopened') {
          resBanner.style.display = 'flex';
          resText.innerHTML = 'Customer <strong>reopened this ticket</strong> — take another look.';
        } else {
          resBanner.style.display = 'none';
        }
      }

      // Flag when the ticket is currently escalated and why.
      var escBanner = document.getElementById('dashEscalationBanner');
      var escText = document.getElementById('dashEscalationText');
      if (escBanner && escText) {
        if (t.status === 'Escalated' && t.escalation) {
          escBanner.style.display = 'flex';
          escText.innerHTML = 'Escalated to <strong>' + t.escalation.to + '</strong>' +
            (t.escalation.by ? ' by ' + t.escalation.by : '') + ': "' + t.escalation.reason + '"';
        } else {
          escBanner.style.display = 'none';
        }
      }

      // Show the resolution summary left when this ticket was marked resolved,
      // so it stays visible to any agent even after the customer reopens it.
      var resSummaryBanner = document.getElementById('dashResolutionSummaryBanner');
      var resSummaryText = document.getElementById('dashResolutionSummaryText');
      if (resSummaryBanner && resSummaryText) {
        if (t.resolutionSummary) {
          resSummaryBanner.style.display = 'flex';
          resSummaryText.textContent = t.resolutionSummary.by
            ? 'Resolution (' + t.resolutionSummary.by + '): ' + t.resolutionSummary.text
            : 'Resolution: ' + t.resolutionSummary.text;
        } else {
          resSummaryBanner.style.display = 'none';
        }
      }

      // Show the customer's CSAT rating, once they've submitted one.
      var csatBanner = document.getElementById('dashCsatBanner');
      if (csatBanner) {
        if (t.csat) {
          csatBanner.style.display = 'flex';
          var csatStars = document.getElementById('dashCsatStars');
          csatStars.innerHTML = '';
          for (var i = 1; i <= 5; i++) {
            var s = document.createElement('span');
            s.className = 'csat-star' + (i <= t.csat.score ? ' active' : '');
            s.textContent = '★';
            csatStars.appendChild(s);
          }
          var csatText = document.getElementById('dashCsatText');
          csatText.textContent = 'Customer rated this ' + t.csat.score + '/5' + (t.csat.comment ? ': "' + t.csat.comment + '"' : '.');
        } else {
          csatBanner.style.display = 'none';
        }
      }
    }

    function renderList() {
      var listEl = document.getElementById('queueList');
      var q = searchQuery.trim().toLowerCase();
      var filtered = tickets.filter(function (t) {
        if (currentFilter === 'Mine' && !isMine(t)) return false;
        if (currentFilter !== 'All' && currentFilter !== 'Mine' && t.priority !== currentFilter) return false;
        if (statusFilter && t.status !== statusFilter) return false;
        if (categoryFilter && t.category !== categoryFilter) return false;
        if (dateFilter) {
          var createdDate = t.createdAt ? t.createdAt.slice(0, 10) : '';
          if (createdDate !== dateFilter) return false;
        }
        if (q) {
          var haystack = (t.id + ' ' + t.subject + ' ' + (t.email || '')).toLowerCase();
          if (haystack.indexOf(q) === -1) return false;
        }
        return true;
      });

      listEl.innerHTML = '';

      if (!filtered.length) {
        listEl.innerHTML = '<p class="queue-no-results">No tickets match your search or filters.</p>';
        return;
      }

      filtered.forEach(function (t) {
        var row = document.createElement('div');
        row.className = 'history-row ' + statusClass(t.status);
        row.dataset.ticketId = t.id;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', 'View details for ' + t.subject);
        if (t.id === selectedId) row.classList.add('active');
        row.innerHTML =
          '<div class="history-main">' +
            '<p class="history-id">' + t.id + '</p>' +
            '<p class="history-subject">' + t.subject + '</p>' +
          '</div>' +
          '<div class="history-meta">' +
            '<span class="history-chip">' + t.category + '</span>' +
            '<span class="history-chip">' + t.priority + '</span>' +
            '<span class="history-chip">' + (t.assignedAgent ? t.assignedAgent : '<span class="history-unassigned">Unassigned</span>') + '</span>' +
            '<span class="history-status">' + t.status + '</span>' +
          '</div>';
        row.addEventListener('click', function () { selectedId = t.id; renderDetail(); renderList(); });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedId = t.id; renderDetail(); renderList(); }
        });
        listEl.appendChild(row);
      });
    }

    document.getElementById('assignToMeBtn').addEventListener('click', function () {
      var t = tickets.filter(function (x) { return x.id === selectedId; })[0];
      if (!t) return;
      var btn = document.getElementById('assignToMeBtn');
      btn.disabled = true; // re-enabled by renderDetail on success
      assignTicket(t.id, agent.id, function (updated) {
        replaceTicketIn(tickets, updated);
        // Keep the poll's signature in step so it doesn't re-render on top of
        // a change this tab just made.
        agentKnownSignature[updated.id] = updated.status + '|' + (updated.assignedAgent || '');
        renderStats(); renderDetail(); renderList();
      }, function (err) {
        btn.disabled = false;
        alert(err.message || 'Unable to assign this ticket.');
      });
    });

    document.querySelectorAll('.filter-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        currentFilter = chip.dataset.filter;
        renderList();
      });
    });

    // FR-14: search by ticket number/requester/subject, plus status/category/date filters
    var queueSearchInput = document.getElementById('queueSearchInput');
    var queueStatusFilter = document.getElementById('queueStatusFilter');
    var queueCategoryFilter = document.getElementById('queueCategoryFilter');
    var queueDateFilter = document.getElementById('queueDateFilter');
    var queueClearFilters = document.getElementById('queueClearFilters');

    if (queueSearchInput) {
      queueSearchInput.addEventListener('input', function () {
        searchQuery = queueSearchInput.value;
        renderList();
      });
    }
    if (queueStatusFilter) {
      queueStatusFilter.addEventListener('change', function () {
        statusFilter = queueStatusFilter.value;
        renderList();
      });
    }
    if (queueCategoryFilter) {
      queueCategoryFilter.addEventListener('change', function () {
        categoryFilter = queueCategoryFilter.value;
        renderList();
      });
    }
    if (queueDateFilter) {
      queueDateFilter.addEventListener('change', function () {
        dateFilter = queueDateFilter.value;
        renderList();
      });
    }
    if (queueClearFilters) {
      queueClearFilters.addEventListener('click', function () {
        searchQuery = ''; statusFilter = ''; categoryFilter = ''; dateFilter = '';
        if (queueSearchInput) queueSearchInput.value = '';
        if (queueStatusFilter) queueStatusFilter.value = '';
        if (queueCategoryFilter) queueCategoryFilter.value = '';
        if (queueDateFilter) queueDateFilter.value = '';
        renderList();
      });
    }

    // Renders whatever `tickets` currently holds. Called once the initial
    // fetch resolves (and on failure, which lands on the empty state).
    function bootstrapAgentQueue() {
      if (!tickets.length) {
        document.getElementById('queueEmpty').style.display = 'block';
        document.getElementById('agentDash').style.display = 'none';
        return;
      }
      document.getElementById('queueEmpty').style.display = 'none';
      document.getElementById('agentDash').style.display = '';
      renderStats();
      renderDetail();
      renderList();
    }

    // ---- FR-4 (agent side): pick up ticket changes made elsewhere ----
    // An admin reassigning/escalating a ticket, or another agent acting on a
    // shared one, writes to the same `docketTickets` record from a different
    // tab/window. Without this, this queue would silently go stale until the
    // agent manually reloads. Mirrors the customer portal's live-update
    // handling below, but keyed on status+assignedAgent (a reassignment alone
    // doesn't change status) and re-renders in place rather than toasting.
    var agentKnownSignature = {};
    tickets.forEach(function (t) { agentKnownSignature[t.id] = t.status + '|' + (t.assignedAgent || ''); });

    function applyRemoteAgentUpdate(updated) {
      if (!updated) return;

      // Only re-render on an actual change — the poll fires every 4s and a
      // careless unconditional re-render would blow away whatever an agent
      // is mid-typing in an open reassign/escalate/resolve panel.
      var changed = updated.length !== tickets.length;
      updated.forEach(function (t) {
        var sig = t.status + '|' + (t.assignedAgent || '');
        if (agentKnownSignature[t.id] !== sig) changed = true;
        agentKnownSignature[t.id] = sig;
      });
      if (!changed) return;

      tickets = updated;
      if (selectedId && !tickets.some(function (t) { return t.id === selectedId; })) {
        selectedId = tickets.length ? tickets[0].id : null;
      }
      if (!tickets.length) {
        document.getElementById('queueEmpty').style.display = 'block';
        document.getElementById('agentDash').style.display = 'none';
      } else {
        document.getElementById('queueEmpty').style.display = 'none';
        document.getElementById('agentDash').style.display = '';
        renderStats(); renderDetail(); renderList();
      }
    }

    // Initial load. The agent and user directories are warmed first because
    // normalizeTicket() reads both to resolve assignedAgent and the requester
    // email the queue search matches against.
    withDirectories(function () {
      fetchTickets(null, function (rows) {
        tickets = rows;
        selectedId = tickets.length ? tickets[0].id : null;
        tickets.forEach(function (t) {
          agentKnownSignature[t.id] = t.status + '|' + (t.assignedAgent || '');
        });
        bootstrapAgentQueue();
      }, function () {
        bootstrapAgentQueue();
      });
    });

    // The `storage` listener that used to drive this is gone along with the
    // localStorage ticket store; the poll is now the only path by which this
    // queue notices a change made elsewhere. Still a no-op until a status or
    // assignment actually moves, so an open reassign/escalate/resolve panel
    // doesn't get blown away mid-edit.
    setInterval(function () {
      fetchTickets(null, applyRemoteAgentUpdate);
    }, 4000);
  }

  // ---- Ticket chat (ticket-chat.html): shared thread between agent and customer ----
  var chatThread = document.getElementById('chatThread');
  if (chatThread) {
    var chatParams = new URLSearchParams(window.location.search);
    var chatTicketId = chatParams.get('ticket');
    var chatRoleParam = chatParams.get('role');
    var chatRole = chatRoleParam === 'agent' ? 'agent' : (chatRoleParam === 'admin' ? 'admin' : 'customer');

    var chatActor = null;
    if (chatRole === 'agent') {
      try { chatActor = JSON.parse(localStorage.getItem('docketAgent')); } catch (e) { chatActor = null; }
      if (!chatActor) { window.location.href = 'agent-login.html'; return; }
    } else if (chatRole === 'admin') {
      try { chatActor = JSON.parse(localStorage.getItem('docketAdmin')); } catch (e) { chatActor = null; }
      if (!chatActor) { window.location.href = 'admin-login.html'; return; }
    } else {
      try { chatActor = JSON.parse(localStorage.getItem('docketUser')); } catch (e) { chatActor = null; }
      if (!chatActor) { window.location.href = 'landing.html'; return; }
    }
    var chatActorName = (chatRole === 'agent' || chatRole === 'admin') ? chatActor.name : chatActor.name.split(' ')[0];

    document.getElementById('chatRoleBadge').innerHTML = '<span class="dot"></span>' +
      (chatRole === 'agent' ? 'Agent Console' : chatRole === 'admin' ? 'Admin Console' : 'Customer Portal');
    document.getElementById('chatBackBtn').addEventListener('click', function () {
      window.location.href = chatRole === 'agent' ? 'agent-dashboard.html' : chatRole === 'admin' ? 'admin-dashboard.html' : 'portal.html';
    });

    // The chat header needs the ticket's subject and priority. Those used to be
    // read out of the `docketTickets` localStorage array, which 1D-i removed —
    // so this fetches the one ticket from the API instead (see initChat below).
    // The messages themselves still live in `docketChat:<id>` until 1D-v.
    var chatTicket = null;

    var chatInput = document.getElementById('chatInput');
    var chatSendBtn = document.getElementById('chatSendBtn');
    var chatVisibility = 'public';
    var visToggle = document.getElementById('chatVisibilityToggle');

    var chatEscapeHtml = function (str) {
      return str.replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };

    // Pending attachments for the message currently being composed
    var chatFiles = [];
    var chatAttachBtn = document.getElementById('chatAttachBtn');
    var chatAttachInput = document.getElementById('chatAttachInput');
    var chatFileListEl = document.getElementById('chatFileList');

    function renderChatFiles() {
      if (!chatFileListEl) return;
      chatFileListEl.innerHTML = '';
      chatFiles.forEach(function (name, i) {
        var chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.innerHTML = '<span>' + chatEscapeHtml(name) + '</span>';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Remove ' + name);
        btn.textContent = '✕';
        btn.addEventListener('click', function () { chatFiles.splice(i, 1); renderChatFiles(); });
        chip.appendChild(btn);
        chatFileListEl.appendChild(chip);
      });
    }

    if (chatAttachBtn && chatAttachInput) {
      chatAttachBtn.addEventListener('click', function () { chatAttachInput.click(); });
      chatAttachInput.addEventListener('change', function () {
        Array.prototype.forEach.call(chatAttachInput.files, function (f) { chatFiles.push(f.name); });
        chatAttachInput.value = '';
        renderChatFiles();
      });
    }

    // Keeps the ticket's "files attached" count (shown on the portal/agent dashboard) in sync
    // whenever someone attaches files from the chat thread, not just at creation time.
    // Dead until 1D-v: this bumped the attachment count on the `docketTickets`
    // record, which no longer exists, so it now finds nothing and writes
    // nothing. Harmless, but it does mean a public chat attachment stops
    // incrementing the ticket's file count until the comments phase moves this
    // to the API (the server already computes attachment_count correctly).
    function bumpTicketFileCount(ticketId, addCount) {
      var allT = [];
      try { allT = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { allT = []; }
      var match = allT.filter(function (x) { return x.id === ticketId; })[0];
      if (match) {
        match.files = (match.files || 0) + addCount;
        localStorage.setItem('docketTickets', JSON.stringify(allT));
      }
      var latestT = null;
      try { latestT = JSON.parse(localStorage.getItem('docketLatestTicket')); } catch (e) { latestT = null; }
      if (latestT && latestT.id === ticketId) {
        latestT.files = (latestT.files || 0) + addCount;
        localStorage.setItem('docketLatestTicket', JSON.stringify(latestT));
      }
    }

    if ((chatRole === 'agent' || chatRole === 'admin') && visToggle) {
      visToggle.style.display = 'flex';
      visToggle.querySelectorAll('.vis-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          visToggle.querySelectorAll('.vis-chip').forEach(function (c) { c.classList.remove('active'); });
          chip.classList.add('active');
          chatVisibility = chip.dataset.visibility;
          chatSendBtn.textContent = chatVisibility === 'internal' ? 'Add note' : 'Send';
          chatInput.placeholder = chatVisibility === 'internal'
            ? 'Add an internal note — not visible to the customer'
            : 'Type a message… share the steps to fix this issue';
        });
      });
    }

    function initChat() {
      if (!chatTicket) {
        document.getElementById('chatTicketId').textContent = 'Ticket not found';
        document.getElementById('chatTicketSubject').textContent = '';
        document.getElementById('chatTicketPriority').style.display = 'none';
        chatInput.disabled = true;
        chatSendBtn.disabled = true;
        if (chatAttachBtn) chatAttachBtn.disabled = true;
        chatThread.innerHTML = '<p class="chat-empty">This ticket could not be found in this browser.</p>';
      } else {
        document.getElementById('chatTicketId').textContent = chatTicket.id;
        document.getElementById('chatTicketSubject').textContent = chatTicket.subject;
        document.getElementById('chatTicketPriority').textContent = chatTicket.priority;

        var chatKey = 'docketChat:' + chatTicket.id;

        var escapeHtml = function (str) {
          return str.replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
          });
        };

        var formatChatTime = function (d) {
          var h = d.getHours(); var m = d.getMinutes();
          var ampm = h >= 12 ? 'PM' : 'AM';
          h = h % 12; if (h === 0) h = 12;
          return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
        };

        var loadChatMessages = function () {
          var msgs = [];
          try { msgs = JSON.parse(localStorage.getItem(chatKey)) || []; } catch (e) { msgs = []; }
          return msgs;
        };

        var renderChatMessages = function () {
          var msgs = loadChatMessages();
          // Customers only ever see public comments; internal notes are agent/team-only.
          if (chatRole === 'customer') {
            msgs = msgs.filter(function (m) { return m.visibility !== 'internal'; });
          }
          chatThread.innerHTML = '';
          if (!msgs.length) {
            chatThread.innerHTML = '<p class="chat-empty">No messages yet — say hello or share the steps to fix this.</p>';
            return;
          }
          msgs.forEach(function (m) {
            var isInternal = m.visibility === 'internal';
            var mine = m.from === chatRole;
            var bubble = document.createElement('div');
            bubble.className = 'chat-bubble ' + (isInternal ? 'internal' : (mine ? 'out' : 'in'));
            var label = isInternal
              ? (mine ? 'You · Internal note' : escapeHtml(m.name) + ' · Internal note')
              : (mine ? 'You' : escapeHtml(m.name));
            var filesHtml = '';
            if (m.files && m.files.length) {
              filesHtml = '<div class="chat-attachments">' + m.files.map(function (f) {
                return '<span class="chat-attachment-chip">📎 ' + escapeHtml(f) + '</span>';
              }).join('') + '</div>';
            }
            bubble.innerHTML =
              '<span class="chat-name">' + label + '</span>' +
              (m.text ? escapeHtml(m.text) : '') +
              filesHtml +
              '<span class="chat-time">' + m.time + '</span>';
            chatThread.appendChild(bubble);
          });
          chatThread.scrollTop = chatThread.scrollHeight;
        };

        var sendChatMessage = function () {
          var text = chatInput.value.trim();
          if (!text && !chatFiles.length) return;
          var msgs = loadChatMessages();
          var visibility = ((chatRole === 'agent' || chatRole === 'admin') && chatVisibility === 'internal') ? 'internal' : 'public';
          var msg = { from: chatRole, name: chatActorName, text: text, time: formatChatTime(new Date()), visibility: visibility };
          if (chatFiles.length) msg.files = chatFiles.slice();
          msgs.push(msg);
          localStorage.setItem(chatKey, JSON.stringify(msgs));
          chatInput.value = '';
          if (chatFiles.length) {
            // Internal notes are agent/team-only, so their attachments shouldn't count toward
            // the customer-visible "files attached" total shown on the portal.
            if (visibility === 'public') bumpTicketFileCount(chatTicket.id, chatFiles.length);
            chatFiles = [];
            renderChatFiles();
          }
          renderChatMessages();
        };

        chatSendBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
        });

        renderChatMessages();
      }
    }

    // GET /api/tickets/:id — a 404 (or a bad ?ticket= param) falls through to
    // initChat's existing "not found" branch, which disables the composer.
    fetch(API_BASE + '/api/tickets/' + encodeURIComponent(chatTicketId))
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (row) {
        if (row) chatTicket = normalizeTicket(row);
        initChat();
      })
      .catch(function (err) {
        console.error('Chat ticket load error:', err);
        initChat();
      });
  }

  // ---- Portal topbar actions ----
  var backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      if (document.referrer && document.referrer.indexOf(window.location.host) !== -1) {
        window.history.back();
      } else {
        window.location.href = 'ticket.html';
      }
    });
  }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      localStorage.removeItem('docketUser');
      window.location.href = 'landing.html';
    });
  }

  // ---- Admin console (admin-dashboard.html): sitewide queue overview, assign/reassign
  // any ticket regardless of who currently holds it, and manage the agent directory ----
  var adminConsole = document.getElementById('adminConsole');
  if (adminConsole) {
    var adminUser = null;
    try { adminUser = JSON.parse(localStorage.getItem('docketAdmin')); } catch (e) { adminUser = null; }
    if (!adminUser) {
      window.location.href = 'admin-login.html';
      return;
    }

    var adminInitials = adminUser.name.trim().split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase() || '?';
    document.getElementById('adminInitials').textContent = adminInitials;
    document.getElementById('adminName').textContent = adminUser.name;
    document.getElementById('adminId').textContent = adminUser.id;
    document.getElementById('adminEmailDisplay').textContent = adminUser.email;
    document.getElementById('adminChipInitials').textContent = adminInitials;
    document.getElementById('adminChipName').textContent = adminUser.name.split(' ')[0];

    document.getElementById('adminLogoutBtn').addEventListener('click', function () {
      localStorage.removeItem('docketAdmin');
      window.location.href = 'admin-login.html';
    });

    // Load the agent directory once up front (see refreshAgentDirectory above);
    // everything below reads the synchronous loadAgents() cache and just gets
    // re-rendered here once the real data is in.
    refreshAgentDirectory(function () {
      renderAdminStats();
      populateAssigneeFilter();
      var agentsPanel = document.getElementById('adminAgentsPanel');
      if (agentsPanel && agentsPanel.style.display !== 'none') renderAgentDirectory();
    });

    // Tickets — fetched from the API at the bottom of this block, the same
    // GET /api/tickets the agent queue reads, so the two consoles are looking
    // at one source of truth again rather than a shared localStorage array.
    var adminTickets = [];

    // (persistAdminTickets is gone — the admin console's only write was
    // assignment, which now goes through PATCH /api/tickets/:id/assign.)

    function adminStatusClass(status) {
      if (status === 'Resolved') return 'status-resolved';
      if (status === 'Closed') return 'status-closed';
      if (status === 'Reopened') return 'status-reopened';
      if (status === 'In Progress') return 'status-progress';
      if (status === 'Waiting') return 'status-waiting';
      if (status === 'Escalated') return 'status-escalated';
      return '';
    }
    function adminIsOpen(status) { return status !== 'Resolved' && status !== 'Closed'; }

    var adminSelectedId = adminTickets.length ? adminTickets[0].id : null;
    var adminSearchQuery = '', adminStatusFilter = '', adminCategoryFilter = '', adminAssigneeFilter = '';

    function renderAdminStats() {
      document.getElementById('adminStatOpen').textContent = adminTickets.filter(function (t) { return adminIsOpen(t.status); }).length;
      document.getElementById('adminStatCritical').textContent = adminTickets.filter(function (t) { return t.priority === 'Critical' && adminIsOpen(t.status); }).length;
      document.getElementById('adminStatUnassigned').textContent = adminTickets.filter(function (t) { return !t.assignedAgent && adminIsOpen(t.status); }).length;
      document.getElementById('adminStatResolved').textContent = adminTickets.filter(function (t) { return t.status === 'Resolved' || t.status === 'Closed'; }).length;
      document.getElementById('adminSidebarTicketCount').textContent = adminTickets.length;
      document.getElementById('adminSidebarAgentCount').textContent = loadAgents().length;
    }

    function formatAdminNoteTime(d) {
      var h = d.getHours(); var m = d.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    }
    // Same internal-note trail agents leave for reassign/escalate, so an admin's
    // assignment shows up in the ticket's existing chat thread too.
    function addAdminNote(ticketId, text) {
      var chatKey = 'docketChat:' + ticketId;
      var msgs = [];
      try { msgs = JSON.parse(localStorage.getItem(chatKey)) || []; } catch (e) { msgs = []; }
      msgs.push({ from: 'agent', name: adminUser.name + ' (Admin)', text: text, time: formatAdminNoteTime(new Date()), visibility: 'internal' });
      localStorage.setItem(chatKey, JSON.stringify(msgs));
    }

    var adminAssignPanel = document.getElementById('adminAssignPanel');
    var adminAssignSelect = document.getElementById('adminAssignSelect');
    var adminAssignNote = document.getElementById('adminAssignNote');

    function openAdminAssignPanel(t) {
      adminAssignSelect.innerHTML = '';
      var unassignedOpt = document.createElement('option');
      unassignedOpt.value = '';
      unassignedOpt.textContent = 'Unassigned';
      if (!t.assignedAgentId) unassignedOpt.selected = true;
      adminAssignSelect.appendChild(unassignedOpt);
      // Option values are agent ids — what PATCH /assign takes — labelled by name.
      loadAgents().forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.name;
        if (a.id === t.assignedAgentId) opt.selected = true;
        adminAssignSelect.appendChild(opt);
      });
      adminAssignNote.value = '';
      clearPanelError(adminAssignPanel);
      adminAssignPanel.style.display = 'block';
    }
    function closeAdminAssignPanel() { adminAssignPanel.style.display = 'none'; }

    document.getElementById('adminAssignBtn').addEventListener('click', function () {
      var t = adminTickets.filter(function (x) { return x.id === adminSelectedId; })[0];
      if (!t) return;
      if (adminAssignPanel.style.display === 'block') { closeAdminAssignPanel(); return; }
      openAdminAssignPanel(t);
    });
    document.getElementById('adminAssignCancelBtn').addEventListener('click', closeAdminAssignPanel);
    document.getElementById('adminAssignConfirmBtn').addEventListener('click', function () {
      var t = adminTickets.filter(function (x) { return x.id === adminSelectedId; })[0];
      if (!t) return;
      var toId = adminAssignSelect.value; // '' means the Unassigned option was picked
      if (toId === (t.assignedAgentId || '')) { closeAdminAssignPanel(); return; }

      var from = t.assignedAgent || 'Unassigned';
      var toName = toId ? agentNameForId(toId) : null;
      var note = adminAssignNote.value.trim();
      var confirmBtn = document.getElementById('adminAssignConfirmBtn');

      clearPanelError(adminAssignPanel);
      confirmBtn.disabled = true;
      assignTicket(t.id, toId, function (updated) {
        confirmBtn.disabled = false;
        replaceTicketIn(adminTickets, updated);
        adminKnownSignature[updated.id] = updated.status + '|' + (updated.assignedAgent || '');
        var noteText = toName
          ? (from === 'Unassigned' ? 'Assigned to ' + toName : 'Reassigned from ' + from + ' to ' + toName)
          : 'Unassigned (was ' + from + ')';
        // Still a localStorage internal note until 1D-v moves comments.
        addAdminNote(updated.id, noteText + ' by an admin' + (note ? ' — ' + note : '.'));
        closeAdminAssignPanel();
        renderAdminStats(); renderAdminDetail(); renderAdminList();
      }, function (err) {
        confirmBtn.disabled = false;
        showPanelError(adminAssignPanel, err.message || 'Unable to update the assignment.');
      });
    });

    function renderAdminDetail() {
      var dash = document.getElementById('adminDash');
      var t = adminTickets.filter(function (x) { return x.id === adminSelectedId; })[0];
      if (!t) { dash.style.display = 'none'; return; }
      dash.style.display = 'block';
      closeAdminAssignPanel();

      document.getElementById('adminDashId').textContent = t.id;
      document.getElementById('adminDashSubject').textContent = t.subject;
      document.getElementById('adminDashDescription').textContent = t.description ? t.description : 'No description provided.';
      document.getElementById('adminDashCategory').textContent = t.category;
      document.getElementById('adminDashPriority').textContent = t.priority;
      document.getElementById('adminDashTeam').textContent = t.team;
      document.getElementById('adminDashSla').textContent = t.sla;
      document.getElementById('adminDashFiles').textContent = t.files ? t.files + ' attached' : 'None';
      document.getElementById('adminDashEmail').textContent = t.email;
      document.getElementById('adminDashAgent').textContent = t.assignedAgent || 'Unassigned';

      var adminAttBlock = document.getElementById('adminDashAttachmentsBlock');
      if (adminAttBlock) {
        if (t.attachments && t.attachments.length) {
          renderAttachmentChips(document.getElementById('adminDashAttachmentsList'), t.attachments);
          adminAttBlock.style.display = '';
        } else {
          adminAttBlock.style.display = 'none';
        }
      }

      var badge = document.getElementById('adminDashStatusBadge');
      badge.textContent = t.status;
      badge.className = 'status-badge ' + adminStatusClass(t.status);

      var serviceBox = document.getElementById('adminDashServiceBox');
      if (t.service) {
        document.getElementById('adminDashService').textContent = t.service;
        serviceBox.style.display = '';
      } else {
        serviceBox.style.display = 'none';
      }

      var escBanner = document.getElementById('adminDashEscalationBanner');
      var escText = document.getElementById('adminDashEscalationText');
      if (t.status === 'Escalated' && t.escalation) {
        escBanner.style.display = 'flex';
        escText.innerHTML = 'Escalated to <strong>' + t.escalation.to + '</strong>' +
          (t.escalation.by ? ' by ' + t.escalation.by : '') + ': "' + t.escalation.reason + '"';
      } else {
        escBanner.style.display = 'none';
      }

      document.getElementById('adminOpenChatBtn').setAttribute('href', 'ticket-chat.html?ticket=' + encodeURIComponent(t.id) + '&role=admin');
    }

    function renderAdminList() {
      var listEl = document.getElementById('adminQueueList');
      var q = adminSearchQuery.trim().toLowerCase();
      var filtered = adminTickets.filter(function (t) {
        if (adminStatusFilter && t.status !== adminStatusFilter) return false;
        if (adminCategoryFilter && t.category !== adminCategoryFilter) return false;
        if (adminAssigneeFilter === 'Unassigned' && t.assignedAgent) return false;
        if (adminAssigneeFilter && adminAssigneeFilter !== 'Unassigned' && t.assignedAgent !== adminAssigneeFilter) return false;
        if (q) {
          var haystack = (t.id + ' ' + t.subject + ' ' + (t.email || '')).toLowerCase();
          if (haystack.indexOf(q) === -1) return false;
        }
        return true;
      });

      listEl.innerHTML = '';
      if (!filtered.length) {
        listEl.innerHTML = '<p class="queue-no-results">No tickets match your search or filters.</p>';
        return;
      }

      filtered.forEach(function (t) {
        var row = document.createElement('div');
        row.className = 'history-row ' + adminStatusClass(t.status);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', 'View details for ' + t.subject);
        if (t.id === adminSelectedId) row.classList.add('active');
        row.innerHTML =
          '<div class="history-main">' +
            '<p class="history-id">' + t.id + '</p>' +
            '<p class="history-subject">' + t.subject + '</p>' +
          '</div>' +
          '<div class="history-meta">' +
            '<span class="history-chip">' + t.category + '</span>' +
            '<span class="history-chip">' + t.priority + '</span>' +
            '<span class="history-chip">' + (t.assignedAgent ? t.assignedAgent : '<span class="history-unassigned">Unassigned</span>') + '</span>' +
            '<span class="history-status">' + t.status + '</span>' +
          '</div>';
        row.addEventListener('click', function () { adminSelectedId = t.id; renderAdminDetail(); renderAdminList(); });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adminSelectedId = t.id; renderAdminDetail(); renderAdminList(); }
        });
        listEl.appendChild(row);
      });
    }

    var aqAssignee = document.getElementById('adminQueueAssigneeFilter');
    // Re-runnable (not just a one-time forEach) so it can be called again once
    // refreshAgentDirectory's fetch resolves, without duplicating options.
    function populateAssigneeFilter() {
      if (!aqAssignee) return;
      Array.prototype.slice.call(aqAssignee.querySelectorAll('option[data-agent-option]')).forEach(function (opt) { opt.remove(); });
      loadAgents().forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.name; opt.textContent = a.name;
        opt.setAttribute('data-agent-option', '1');
        aqAssignee.appendChild(opt);
      });
    }
    populateAssigneeFilter();
    var aqSearch = document.getElementById('adminQueueSearchInput');
    var aqStatus = document.getElementById('adminQueueStatusFilter');
    var aqCategory = document.getElementById('adminQueueCategoryFilter');
    var aqClear = document.getElementById('adminQueueClearFilters');
    if (aqSearch) aqSearch.addEventListener('input', function () { adminSearchQuery = aqSearch.value; renderAdminList(); });
    if (aqStatus) aqStatus.addEventListener('change', function () { adminStatusFilter = aqStatus.value; renderAdminList(); });
    if (aqCategory) aqCategory.addEventListener('change', function () { adminCategoryFilter = aqCategory.value; renderAdminList(); });
    if (aqAssignee) aqAssignee.addEventListener('change', function () { adminAssigneeFilter = aqAssignee.value; renderAdminList(); });
    if (aqClear) {
      aqClear.addEventListener('click', function () {
        adminSearchQuery = ''; adminStatusFilter = ''; adminCategoryFilter = ''; adminAssigneeFilter = '';
        if (aqSearch) aqSearch.value = '';
        if (aqStatus) aqStatus.value = '';
        if (aqCategory) aqCategory.value = '';
        if (aqAssignee) aqAssignee.value = '';
        renderAdminList();
      });
    }

    // Renders whatever `adminTickets` currently holds. Called once the initial
    // fetch resolves (and on failure, which lands on the empty state).
    function bootstrapAdminConsole() {
      if (!adminTickets.length) {
        document.getElementById('adminQueueEmpty').style.display = 'block';
        document.getElementById('adminDash').style.display = 'none';
        return;
      }
      document.getElementById('adminQueueEmpty').style.display = 'none';
      document.getElementById('adminDash').style.display = '';
      renderAdminStats(); renderAdminDetail(); renderAdminList();
    }

    // ---- FR-4 (admin side): pick up ticket changes made elsewhere ----
    // Same gap as the agent queue — an agent moving a ticket's status (or
    // another admin reassigning one) writes to `docketTickets` from a
    // different tab/window, and this console would otherwise sit stale
    // until reloaded. See the matching block in the agent-queue section
    // above for the fuller rationale; kept as a separate copy here since
    // it drives a different ticket array and set of render functions.
    var adminKnownSignature = {};
    adminTickets.forEach(function (t) { adminKnownSignature[t.id] = t.status + '|' + (t.assignedAgent || ''); });

    function applyRemoteAdminUpdate(updated) {
      if (!updated) return;

      var changed = updated.length !== adminTickets.length;
      updated.forEach(function (t) {
        var sig = t.status + '|' + (t.assignedAgent || '');
        if (adminKnownSignature[t.id] !== sig) changed = true;
        adminKnownSignature[t.id] = sig;
      });
      if (!changed) return;

      adminTickets = updated;
      if (adminSelectedId && !adminTickets.some(function (t) { return t.id === adminSelectedId; })) {
        adminSelectedId = adminTickets.length ? adminTickets[0].id : null;
      }
      if (!adminTickets.length) {
        document.getElementById('adminQueueEmpty').style.display = 'block';
        document.getElementById('adminDash').style.display = 'none';
      } else {
        document.getElementById('adminQueueEmpty').style.display = 'none';
        document.getElementById('adminDash').style.display = '';
        renderAdminStats(); renderAdminDetail(); renderAdminList();
      }
    }

    // Initial load — directories first, same reason as the agent queue: the
    // assignee filter and the queue search both match on names and requester
    // emails that normalizeTicket() resolves from those caches.
    withDirectories(function () {
      fetchTickets(null, function (rows) {
        adminTickets = rows;
        adminSelectedId = adminTickets.length ? adminTickets[0].id : null;
        adminTickets.forEach(function (t) {
          adminKnownSignature[t.id] = t.status + '|' + (t.assignedAgent || '');
        });
        populateAssigneeFilter();
        bootstrapAdminConsole();
      }, function () {
        bootstrapAdminConsole();
      });
    });

    // The `storage` listener is gone with the localStorage ticket store; the
    // poll is now the only way this console notices a change made elsewhere.
    setInterval(function () {
      fetchTickets(null, applyRemoteAdminUpdate);
    }, 4000);

    // ---- Tabs: Tickets / Agents ----
    document.querySelectorAll('.admin-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.admin-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var tab = btn.dataset.tab;
        document.getElementById('adminTicketsPanel').style.display = tab === 'tickets' ? '' : 'none';
        document.getElementById('adminAgentsPanel').style.display = tab === 'agents' ? '' : 'none';
        if (tab === 'agents') renderAgentDirectory();
      });
    });

    // ---- Agents: directory list + create ----
    function ticketCountFor(name) {
      return adminTickets.filter(function (t) { return t.assignedAgent === name; }).length;
    }

    function renderAgentDirectory() {
      var agents = loadAgents();
      document.getElementById('adminAgentCountLabel').textContent = agents.length + (agents.length === 1 ? ' agent' : ' agents');
      document.getElementById('adminSidebarAgentCount').textContent = agents.length;
      var listEl = document.getElementById('adminAgentList');
      listEl.innerHTML = '';
      if (!agents.length) {
        listEl.innerHTML = '<p class="queue-no-results">No agents yet — add the first one above.</p>';
        return;
      }
      agents.forEach(function (a) {
        var row = document.createElement('div');
        row.className = 'history-row';
        var sourceLabel = a.createdBy === 'seed' ? 'Seed data' : (a.createdBy === 'admin' ? 'Added by admin' : 'Self sign-in');
        row.innerHTML =
          '<div class="history-main">' +
            '<p class="history-id">' + a.id + '</p>' +
            '<p class="history-subject">' + a.name + '</p>' +
          '</div>' +
          '<div class="history-meta">' +
            '<span class="history-chip">' + a.email + '</span>' +
            '<span class="history-chip">' + ticketCountFor(a.name) + ' assigned</span>' +
            '<span class="history-chip">' + sourceLabel + '</span>' +
          '</div>';
        listEl.appendChild(row);
      });
    }
    renderAgentDirectory();

    document.getElementById('addAgentBtn').addEventListener('click', function () {
      var nameField = document.getElementById('newAgentName');
      var emailField = document.getElementById('newAgentEmail');
      var nameWrap = document.getElementById('f-newAgentName');
      var emailWrap = document.getElementById('f-newAgentEmail');
      var emailErr = document.getElementById('err-newAgentEmail');
      emailErr.textContent = 'Enter a valid work email.';
      var valid = true;

      if (!nameField.value.trim()) { nameWrap.classList.add('invalid'); valid = false; }
      else { nameWrap.classList.remove('invalid'); }

      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value.trim());
      if (!emailOk) { emailWrap.classList.add('invalid'); valid = false; }
      else { emailWrap.classList.remove('invalid'); }

      if (valid) {
        // Client-side dupe check against the cached directory for instant feedback;
        // the server enforces this too (409) as the source of truth below.
        var agents = loadAgents();
        var dupe = agents.some(function (a) { return a.email.toLowerCase() === emailField.value.trim().toLowerCase(); });
        if (dupe) {
          emailWrap.classList.add('invalid');
          emailErr.textContent = 'An agent with this email already exists.';
          valid = false;
        }
      }

      if (!valid) return;

      var addAgentBtnEl = document.getElementById('addAgentBtn');
      addAgentBtnEl.disabled = true;

      fetch(API_BASE + '/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: nameField.value.trim(),
          email: emailField.value.trim(),
          created_by: 'admin'
        })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw new Error(data.error || 'Unable to add this agent.');
            return data;
          });
        })
        .then(function () {
          nameField.value = '';
          emailField.value = '';
          refreshAgentDirectory(function () {
            renderAgentDirectory();
            renderAdminStats();
          });
        })
        .catch(function (err) {
          emailWrap.classList.add('invalid');
          emailErr.textContent = err.message || 'Unable to add this agent.';
        })
        .finally(function () {
          addAgentBtnEl.disabled = false;
        });
    });
  }

});
