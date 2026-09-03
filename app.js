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

    document.getElementById('submitProfile').addEventListener('click', function () {
      var name = document.getElementById('fullName');
      var email = document.getElementById('email');
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

      var id = genUniqueId('USR', []);
      var newUser = { id: id, name: name.value.trim(), email: email.value.trim() };
      showProfileStub(newUser, false);

      // Hand the profile off to the ticket page (stands in for a real DB lookup by user id)
      localStorage.setItem('docketUser', JSON.stringify(newUser));
    });
  }

  // ---- Agent directory (docketAgents): shared by agent sign-in, the agent dashboard's
  // reassign panel, and the admin console — this replaces the old hardcoded roster array
  // with real records an admin can create, so they persist and are the same list everywhere.
  var AGENT_SEED_NAMES = ['Maya Owusu', 'Kwame Boateng', 'Ama Serwaa', 'Yaw Mensah', 'Efia Asante'];

  function genAgentId(existingAgents) {
    var existingIds = (existingAgents || []).map(function (a) { return a.id; });
    return genUniqueId('AGT', existingIds);
  }

  function slugAgentEmail(name) {
    return name.trim().toLowerCase().replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, '.') + '@docket.com';
  }

  function loadAgents() {
    var agents = [];
    try { agents = JSON.parse(localStorage.getItem('docketAgents')) || []; } catch (e) { agents = []; }
    if (!agents.length) {
      // First run: seed the directory from the old mock roster, so tickets already
      // assigned to these names (from earlier sessions) still resolve to a real record.
      var seeded = [];
      agents = AGENT_SEED_NAMES.map(function (name) {
        var rec = { id: genAgentId(seeded), name: name, email: slugAgentEmail(name), createdAt: new Date().toISOString(), createdBy: 'seed' };
        seeded.push(rec);
        return rec;
      });
      localStorage.setItem('docketAgents', JSON.stringify(agents));
    }
    return agents;
  }

  function saveAgents(agents) {
    localStorage.setItem('docketAgents', JSON.stringify(agents));
  }

  // Looks up (or silently creates) a directory record by email for an agent signing
  // in, so the "any password works" demo sign-in still lands on a stable identity —
  // and on the identity an admin set up, if that email was created from the admin console.
  function findOrCreateAgentByEmail(email, fallbackName) {
    var agents = loadAgents();
    var match = agents.filter(function (a) { return a.email.toLowerCase() === email.toLowerCase(); })[0];
    if (match) return match;
    var rec = { id: genAgentId(agents), name: fallbackName, email: email, createdAt: new Date().toISOString(), createdBy: 'self-signup' };
    agents.push(rec);
    saveAgents(agents);
    return rec;
  }

  // ---- Agent sign-in (agent-login.html): validation + confirmation stub ----
  var agentLoginForm = document.getElementById('agentLoginForm');
  if (agentLoginForm) {
    document.getElementById('submitAgentLogin').addEventListener('click', function () {
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
      // Reuses an existing directory record if this email was set up from the admin
      // console (so that identity sticks), otherwise creates one on the fly.
      var record = findOrCreateAgentByEmail(email.value.trim(), displayName);

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
    });
  }
// ---- Admin sign-in (admin-login.html): single seeded super account, validation + confirmation stub ----
  var adminLoginForm = document.getElementById('adminLoginForm');
  if (adminLoginForm) {
    // Unlike agent sign-in (any credentials work), the admin console is a single
    // seeded super account — only this exact email/password combination signs in.
    var SEED_ADMIN = {
      email: 'admin@docket.com',
      password: 'Admin2026!',
      name: 'System Administrator',
      id: 'ADM-2026-000001'
    };

    document.getElementById('submitAdminLogin').addEventListener('click', function () {
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

      var matches = email.value.trim().toLowerCase() === SEED_ADMIN.email && password.value === SEED_ADMIN.password;
      if (!matches) {
        emailField.classList.add('invalid');
        passwordField.classList.add('invalid');
        emailErr.textContent = 'Incorrect email or password.';
        passwordErr.textContent = 'Incorrect email or password.';
        return;
      }

      document.getElementById('adminStubId').textContent = SEED_ADMIN.id;
      document.getElementById('adminStubName').textContent = ', ' + SEED_ADMIN.name.split(' ')[0];
      adminLoginForm.style.display = 'none';
      document.getElementById('adminStub').classList.add('show');

      localStorage.setItem('docketAdmin', JSON.stringify({
        id: SEED_ADMIN.id,
        name: SEED_ADMIN.name,
        email: SEED_ADMIN.email,
        keepSignedIn: document.getElementById('adminKeepSignedIn').checked
      }));
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

    var teams = ['Network Support', 'Application Support', 'Infrastructure', 'Access & Identity'];
    var teamByCategory = {
      'Network': 'Network Support',
      'Application': 'Application Support',
      'Hardware': 'Infrastructure',
      'Access & Identity': 'Access & Identity'
    };
    var slaByPriority = {
      Critical: { response: '15 min', resolution: '4 hrs' },
      High: { response: '30 min', resolution: '8 hrs' },
      Medium: { response: '4 hrs', resolution: '2 days' },
      Low: { response: '1 day', resolution: '5 days' }
    };

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

      var team = teamByCategory[category.value] || teams[Math.floor(Math.random() * teams.length)];
      var sla = slaByPriority[priority.value] || slaByPriority.Medium;

      setTimeout(function () {
        var existingTickets = [];
        try { existingTickets = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { existingTickets = []; }
        var ticketId = genUniqueId('TKT', existingTickets.map(function (t) { return t.id; }));

        var ticket = {
          id: ticketId,
          subject: subject.value.trim(),
          description: description.value.trim(),
          category: category.value,
          priority: priority.value,
          service: service ? service.value.trim() : '',
          team: team,
          sla: sla.response + ' response / ' + sla.resolution + ' resolution',
          files: files.length,
          email: (user && user.email) ? user.email : 'your inbox',
          status: 'Created',
          assignedAgent: null,
          createdAt: new Date().toISOString()
        };

        // Save as the latest ticket (for the portal's headline card)…
        localStorage.setItem('docketLatestTicket', JSON.stringify(ticket));
        // …and append it to the full history list.
        existingTickets.unshift(ticket);
        localStorage.setItem('docketTickets', JSON.stringify(existingTickets));

        window.location.href = 'portal.html';
      }, 2600);
    });
  }

  // ---- Ticket portal (portal.html): profile sidebar + latest ticket + full, clickable history ----
  var dash = document.getElementById('dash');
  if (dash) {
    var portalUser = null;
    try { portalUser = JSON.parse(localStorage.getItem('docketUser')); } catch (e) { portalUser = null; }

    var latest = null;
    try { latest = JSON.parse(localStorage.getItem('docketLatestTicket')); } catch (e) { latest = null; }

    var all = [];
    try { all = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { all = []; }
    // Backfill status/assignment for tickets created before these fields existed
    all = all.map(function (t) {
      if (!t.status) t.status = 'Created';
      if (t.assignedAgent === undefined) t.assignedAgent = null;
      return t;
    });
    if (latest) {
      var latestMatch = all.filter(function (t) { return t.id === latest.id; })[0];
      if (latestMatch) latest = latestMatch;
    }

    // Snapshot of each ticket's status as this tab currently knows it, so a
    // change made elsewhere (an agent updating status on their dashboard, or
    // this same customer with the portal open in a second tab) can be told
    // apart from a status this tab already displayed.
    var knownStatuses = {};
    all.forEach(function (t) { knownStatuses[t.id] = t.status; });

    function portalStatusClass(status) {
      if (status === 'Resolved') return 'status-resolved';
      if (status === 'Closed') return 'status-closed';
      if (status === 'Reopened') return 'status-reopened';
      if (status === 'In Progress') return 'status-progress';
      if (status === 'Waiting') return 'status-waiting';
      if (status === 'Escalated') return 'status-escalated';
      return '';
    }

    // Writes a status change back to the shared ticket store (docketTickets + docketLatestTicket)
    // and keeps this page's in-memory copies (`all`, `latest`) in sync.
    function persistPortalTicket(t) {
      var idx = all.findIndex(function (x) { return x.id === t.id; });
      if (idx !== -1) all[idx] = t;
      localStorage.setItem('docketTickets', JSON.stringify(all));
      if (latest && latest.id === t.id) {
        latest = t;
        localStorage.setItem('docketLatestTicket', JSON.stringify(t));
      }
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
        document.getElementById('profileTicketCount').textContent = all.length;
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

      // Re-sync every row's status pill/class against `all`, since confirming or
      // reopening this ticket updates its status without a full re-render.
      document.querySelectorAll('.history-row').forEach(function (r) {
        var match = all.filter(function (x) { return x.id === r.dataset.ticketId; })[0];
        if (!match) return;
        r.className = 'history-row ' + portalStatusClass(match.status) + (r.dataset.ticketId === t.id ? ' active' : '');
        var statusEl = r.querySelector('.history-status');
        if (statusEl) statusEl.textContent = match.status;
      });
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

    if (!latest) {
      dash.style.display = 'none';
      var empty = document.getElementById('portalEmpty');
      if (empty) empty.style.display = 'block';
    } else {
      showTicketDetails(latest);
    }

    var historySection = document.getElementById('ticketHistory');
    var historyList = document.getElementById('historyList');

    if (all.length && historySection && historyList) {
      historySection.style.display = 'block';
      historyList.innerHTML = '';
      all.forEach(function (t) {
        var row = document.createElement('div');
        row.className = 'history-row ' + portalStatusClass(t.status);
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
        historyList.appendChild(row);
      });
      if (latest) {
        var activeRow = historyList.querySelector('[data-ticket-id="' + latest.id + '"]');
        if (activeRow) activeRow.classList.add('active');
      }
    }

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

    // Parses the latest `docketTickets` value, diffs it against what this tab
    // last knew, refreshes the dashboard/history in place, and toasts every
    // ticket whose status actually moved.
    function applyRemoteTicketUpdate(raw) {
      if (!raw) return;
      var updated;
      try { updated = JSON.parse(raw) || []; } catch (err) { return; }
      updated.forEach(function (t) {
        if (!t.status) t.status = 'Created';
        if (t.assignedAgent === undefined) t.assignedAgent = null;
      });

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

    // `storage` only fires in *other* tabs/windows of this origin — exactly
    // what's needed here, since it means this tab's own writes (confirm fix,
    // reopen, CSAT) never re-trigger a toast about themselves.
    window.addEventListener('storage', function (e) {
      if (e.key === 'docketTickets') applyRemoteTicketUpdate(e.newValue);
    });

    // Light polling fallback in case the storage event doesn't reach this tab
    // (some embedded/preview contexts don't relay it) — harmless either way,
    // since applyRemoteTicketUpdate is a no-op once knownStatuses is caught up.
    setInterval(function () {
      applyRemoteTicketUpdate(localStorage.getItem('docketTickets'));
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

    // Load tickets submitted via the customer portal; backfill status/assignment on older records
    var tickets = [];
    try { tickets = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { tickets = []; }
    tickets = tickets.map(function (t) {
      if (!t.status) t.status = 'Assigned';
      if (t.assignedAgent === undefined) t.assignedAgent = null;
      if (!t.createdAt) t.createdAt = new Date().toISOString();
      return t;
    });

    function persistTickets() {
      localStorage.setItem('docketTickets', JSON.stringify(tickets));
      // Keep the customer portal's headline card in sync if it's showing one of these tickets
      var latest = null;
      try { latest = JSON.parse(localStorage.getItem('docketLatestTicket')); } catch (e) { latest = null; }
      if (latest) {
        var match = tickets.filter(function (t) { return t.id === latest.id; })[0];
        if (match) localStorage.setItem('docketLatestTicket', JSON.stringify(match));
      }
    }
    // Save any status/assignedAgent/createdAt defaults backfilled above so they
    // stay stable across reloads instead of being recomputed (and drifting) each time.
    persistTickets();

    var currentFilter = 'All';
    var searchQuery = '';
    var statusFilter = '';
    var categoryFilter = '';
    var dateFilter = '';
    var selectedId = tickets.length ? tickets[0].id : null;

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
      return !!t.assignedAgent && t.assignedAgent === agent.name;
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
      return isMine(t) || !t.assignedAgent;
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
    // Pulled live from the shared agent directory (docketAgents), so an agent added
    // from the admin console shows up here without any change to this file.
    var AGENT_ROSTER = loadAgents().map(function (a) { return a.name; });
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
      AGENT_ROSTER.filter(function (name) { return name !== agent.name; }).forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        if (name === t.assignedAgent) opt.selected = true;
        reassignSelect.appendChild(opt);
      });
      reassignNote.value = '';
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
      var to = reassignSelect.value; // '' means the Unassigned option was picked
      if (to === (t.assignedAgent || '')) { closePanels(); return; }
      var wasUnassigned = !t.assignedAgent;
      var from = t.assignedAgent || 'Unassigned';
      t.assignedAgent = to || null;
      if (to) {
        if (wasUnassigned && t.status === 'Created') t.status = 'Assigned';
      } else if (t.status !== 'Resolved' && t.status !== 'Closed') {
        // Sending it back to the pool — reset to Created so the status machine's
        // assumption (Assigned+ always has an owner) still holds.
        t.status = 'Created';
      }
      persistTickets();
      var note = reassignNote.value.trim();
      var noteText = to
        ? (wasUnassigned ? 'Assigned to ' + to : 'Reassigned from ' + from + ' to ' + to)
        : 'Unassigned (was ' + from + ')';
      addInternalNote(t.id, noteText + (note ? ' — ' + note : '.'));
      closePanels();
      renderStats(); renderDetail(); renderList();
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
      var mine = tickets.filter(function (t) { return t.assignedAgent === agent.name; }).length;

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
      assignBtn.disabled = t.assignedAgent === agent.name;
      assignBtn.textContent = t.assignedAgent === agent.name ? 'Assigned to you' : 'Assign to me';
      var reassignBtn = document.getElementById('reassignBtn');
      reassignBtn.disabled = !canReassign(t);
      reassignBtn.textContent = t.assignedAgent ? 'Reassign…' : 'Assign to…';
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
          escText.innerHTML = 'Escalated to <strong>' + t.escalation.to + '</strong> by ' + t.escalation.by + ': "' + t.escalation.reason + '"';
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
          resSummaryText.textContent = 'Resolution (' + t.resolutionSummary.by + '): ' + t.resolutionSummary.text;
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
        if (currentFilter === 'Mine' && t.assignedAgent !== agent.name) return false;
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
      t.assignedAgent = agent.name;
      if (t.status === 'Created') t.status = 'Assigned';
      persistTickets();
      renderStats(); renderDetail(); renderList();
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

    if (!tickets.length) {
      document.getElementById('queueEmpty').style.display = 'block';
      document.getElementById('agentDash').style.display = 'none';
    } else {
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

    function applyRemoteAgentUpdate(raw) {
      if (!raw) return;
      var updated;
      try { updated = JSON.parse(raw) || []; } catch (err) { return; }
      updated.forEach(function (t) {
        if (!t.status) t.status = 'Assigned';
        if (t.assignedAgent === undefined) t.assignedAgent = null;
      });

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

    // `storage` only fires in *other* tabs/windows of this origin, so this
    // tab's own writes (assign to me, status moves, reassign/escalate/resolve)
    // never re-trigger themselves.
    window.addEventListener('storage', function (e) {
      if (e.key === 'docketTickets') applyRemoteAgentUpdate(e.newValue);
    });
    // Polling fallback for contexts where the storage event doesn't relay —
    // a no-op once agentKnownSignature is caught up, same as the portal's.
    setInterval(function () {
      applyRemoteAgentUpdate(localStorage.getItem('docketTickets'));
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

    var chatAllTickets = [];
    try { chatAllTickets = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { chatAllTickets = []; }
    var chatTicket = chatAllTickets.filter(function (t) { return t.id === chatTicketId; })[0];

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

    // Tickets — same shared docketTickets record every other view reads/writes
    var adminTickets = [];
    try { adminTickets = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { adminTickets = []; }
    adminTickets = adminTickets.map(function (t) {
      if (!t.status) t.status = 'Assigned';
      if (t.assignedAgent === undefined) t.assignedAgent = null;
      if (!t.createdAt) t.createdAt = new Date().toISOString();
      return t;
    });

    function persistAdminTickets() {
      localStorage.setItem('docketTickets', JSON.stringify(adminTickets));
      var latestT = null;
      try { latestT = JSON.parse(localStorage.getItem('docketLatestTicket')); } catch (e) { latestT = null; }
      if (latestT) {
        var m = adminTickets.filter(function (t) { return t.id === latestT.id; })[0];
        if (m) localStorage.setItem('docketLatestTicket', JSON.stringify(m));
      }
    }
    persistAdminTickets();

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
      if (!t.assignedAgent) unassignedOpt.selected = true;
      adminAssignSelect.appendChild(unassignedOpt);
      loadAgents().forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.name; opt.textContent = a.name;
        if (a.name === t.assignedAgent) opt.selected = true;
        adminAssignSelect.appendChild(opt);
      });
      adminAssignNote.value = '';
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
      var to = adminAssignSelect.value; // '' means the Unassigned option was picked
      if (to === (t.assignedAgent || '')) { closeAdminAssignPanel(); return; }
      var from = t.assignedAgent || 'Unassigned';
      t.assignedAgent = to || null;
      if (to) {
        if (t.status === 'Created') t.status = 'Assigned';
      } else if (t.status !== 'Resolved' && t.status !== 'Closed') {
        // Sending it back to the pool — reset to Created so the status machine's
        // assumption (Assigned+ always has an owner) still holds.
        t.status = 'Created';
      }
      persistAdminTickets();
      var note = adminAssignNote.value.trim();
      var noteText = to
        ? (from === 'Unassigned' ? 'Assigned to ' + to : 'Reassigned from ' + from + ' to ' + to)
        : 'Unassigned (was ' + from + ')';
      addAdminNote(t.id, noteText + ' by an admin' + (note ? ' — ' + note : '.'));
      closeAdminAssignPanel();
      renderAdminStats(); renderAdminDetail(); renderAdminList();
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
        escText.innerHTML = 'Escalated to <strong>' + t.escalation.to + '</strong> by ' + t.escalation.by + ': "' + t.escalation.reason + '"';
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
    if (aqAssignee) {
      loadAgents().forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.name; opt.textContent = a.name;
        aqAssignee.appendChild(opt);
      });
    }
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

    if (!adminTickets.length) {
      document.getElementById('adminQueueEmpty').style.display = 'block';
      document.getElementById('adminDash').style.display = 'none';
    } else {
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

    function applyRemoteAdminUpdate(raw) {
      if (!raw) return;
      var updated;
      try { updated = JSON.parse(raw) || []; } catch (err) { return; }
      updated.forEach(function (t) {
        if (!t.status) t.status = 'Assigned';
        if (t.assignedAgent === undefined) t.assignedAgent = null;
      });

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

    window.addEventListener('storage', function (e) {
      if (e.key === 'docketTickets') applyRemoteAdminUpdate(e.newValue);
    });
    setInterval(function () {
      applyRemoteAdminUpdate(localStorage.getItem('docketTickets'));
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
        var agents = loadAgents();
        var dupe = agents.some(function (a) { return a.email.toLowerCase() === emailField.value.trim().toLowerCase(); });
        if (dupe) {
          emailWrap.classList.add('invalid');
          emailErr.textContent = 'An agent with this email already exists.';
          valid = false;
        }
      }

      if (!valid) return;

      var agents2 = loadAgents();
      agents2.push({
        id: genAgentId(agents2),
        name: nameField.value.trim(),
        email: emailField.value.trim(),
        createdAt: new Date().toISOString(),
        createdBy: 'admin'
      });
      saveAgents(agents2);
      nameField.value = '';
      emailField.value = '';
      renderAgentDirectory();
      renderAdminStats();
    });
  }

});
