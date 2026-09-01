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

  // Profile form validation + confirmation stub
  var profileForm = document.getElementById('profileForm');
  if (profileForm) {
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

      var id = 'USR-2026-' + String(Math.floor(Math.random() * 900000) + 100000).slice(0, 6);
      document.getElementById('stubId').textContent = id;
      document.getElementById('stubName').textContent = ', ' + name.value.trim().split(' ')[0];
      profileForm.style.display = 'none';
      document.getElementById('stub').classList.add('show');

      // Hand the profile off to the ticket page (stands in for a real DB lookup by user id)
      localStorage.setItem('docketUser', JSON.stringify({
        id: id,
        name: name.value.trim(),
        email: email.value.trim()
      }));
    });
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
      var id = 'AGT-2026-' + String(Math.floor(Math.random() * 900000) + 100000).slice(0, 6);

      document.getElementById('agentStubId').textContent = id;
      document.getElementById('agentStubName').textContent = ', ' + displayName.split(' ')[0];
      agentLoginForm.style.display = 'none';
      document.getElementById('agentStub').classList.add('show');

      localStorage.setItem('docketAgent', JSON.stringify({
        id: id,
        name: displayName,
        email: email.value.trim(),
        keepSignedIn: document.getElementById('keepSignedIn').checked
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

      var ticketId = 'TKT-2026-' + String(Math.floor(Math.random() * 900000) + 100000).slice(0, 6);
      var team = teams[Math.floor(Math.random() * teams.length)];
      var sla = slaByPriority[priority.value] || slaByPriority.Medium;

      setTimeout(function () {
        var ticket = {
          id: ticketId,
          subject: subject.value.trim(),
          category: category.value,
          priority: priority.value,
          team: team,
          sla: sla.response + ' response / ' + sla.resolution + ' resolution',
          files: files.length,
          email: (user && user.email) ? user.email : 'your inbox',
          status: 'Created',
          assignedAgent: null
        };

        // Save as the latest ticket (for the portal's headline card)…
        localStorage.setItem('docketLatestTicket', JSON.stringify(ticket));
        // …and append it to the full history list.
        var all = [];
        try { all = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { all = []; }
        all.unshift(ticket);
        localStorage.setItem('docketTickets', JSON.stringify(all));

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

    function portalStatusClass(status) {
      if (status === 'Resolved') return 'status-resolved';
      if (status === 'In Progress') return 'status-progress';
      return '';
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
    function showTicketDetails(t) {
      document.getElementById('dashId').textContent = t.id;
      document.getElementById('dashSubject').textContent = t.subject;
      document.getElementById('dashCategory').textContent = t.category;
      document.getElementById('dashPriority').textContent = t.priority;
      document.getElementById('dashTeam').textContent = t.team;
      document.getElementById('dashSla').textContent = t.sla;
      document.getElementById('dashFiles').textContent = t.files ? t.files + ' attached' : 'None';
      document.getElementById('dashEmail').textContent = t.email;
      document.getElementById('dashAgent').textContent = t.assignedAgent || 'Unassigned';

      var statusBadge = document.getElementById('dashStatusBadge');
      statusBadge.textContent = t.status || 'Assigned';
      statusBadge.className = 'status-badge ' + portalStatusClass(t.status);

      var messageAgentBtn = document.getElementById('messageAgentBtn');
      if (messageAgentBtn) messageAgentBtn.setAttribute('href', 'ticket-chat.html?ticket=' + encodeURIComponent(t.id) + '&role=customer');

      document.querySelectorAll('.history-row').forEach(function (r) {
        r.classList.toggle('active', r.dataset.ticketId === t.id);
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

    var currentFilter = 'All';
    var selectedId = tickets.length ? tickets[0].id : null;

    function statusClass(status) {
      if (status === 'Resolved') return 'status-resolved';
      if (status === 'In Progress') return 'status-progress';
      return '';
    }

    function renderStats() {
      var open = tickets.filter(function (t) { return t.status !== 'Resolved'; }).length;
      var critical = tickets.filter(function (t) { return t.priority === 'Critical' && t.status !== 'Resolved'; }).length;
      var unassigned = tickets.filter(function (t) { return !t.assignedAgent && t.status !== 'Resolved'; }).length;
      var resolved = tickets.filter(function (t) { return t.status === 'Resolved'; }).length;
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

      document.getElementById('dashId').textContent = t.id;
      document.getElementById('dashSubject').textContent = t.subject;
      document.getElementById('dashCategory').textContent = t.category;
      document.getElementById('dashPriority').textContent = t.priority;
      document.getElementById('dashTeam').textContent = t.team;
      document.getElementById('dashSla').textContent = t.sla;
      document.getElementById('dashFiles').textContent = t.files ? t.files + ' attached' : 'None';
      document.getElementById('dashEmail').textContent = t.email;
      document.getElementById('dashAgent').textContent = t.assignedAgent || 'Unassigned';

      var badge = document.getElementById('dashStatusBadge');
      badge.textContent = t.status;
      badge.className = 'status-badge ' + statusClass(t.status);

      var assignBtn = document.getElementById('assignToMeBtn');
      var resolveBtn = document.getElementById('resolveBtn');
      assignBtn.disabled = t.assignedAgent === agent.name;
      assignBtn.textContent = t.assignedAgent === agent.name ? 'Assigned to you' : 'Assign to me';
      resolveBtn.disabled = t.status === 'Resolved';
      resolveBtn.textContent = t.status === 'Resolved' ? 'Resolved' : 'Mark resolved';
      document.getElementById('messageCustomerBtn').setAttribute('href', 'ticket-chat.html?ticket=' + encodeURIComponent(t.id) + '&role=agent');
    }

    function renderList() {
      var listEl = document.getElementById('queueList');
      var filtered = tickets.filter(function (t) {
        if (currentFilter === 'All') return true;
        if (currentFilter === 'Mine') return t.assignedAgent === agent.name;
        return t.priority === currentFilter;
      });

      listEl.innerHTML = '';
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

    document.getElementById('resolveBtn').addEventListener('click', function () {
      var t = tickets.filter(function (x) { return x.id === selectedId; })[0];
      if (!t) return;
      t.status = 'Resolved';
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

    if (!tickets.length) {
      document.getElementById('queueEmpty').style.display = 'block';
      document.getElementById('agentDash').style.display = 'none';
    } else {
      renderStats();
      renderDetail();
      renderList();
    }
  }

  // ---- Ticket chat (ticket-chat.html): shared thread between agent and customer ----
  var chatThread = document.getElementById('chatThread');
  if (chatThread) {
    var chatParams = new URLSearchParams(window.location.search);
    var chatTicketId = chatParams.get('ticket');
    var chatRole = chatParams.get('role') === 'agent' ? 'agent' : 'customer';

    var chatActor = null;
    if (chatRole === 'agent') {
      try { chatActor = JSON.parse(localStorage.getItem('docketAgent')); } catch (e) { chatActor = null; }
      if (!chatActor) { window.location.href = 'agent-login.html'; return; }
    } else {
      try { chatActor = JSON.parse(localStorage.getItem('docketUser')); } catch (e) { chatActor = null; }
      if (!chatActor) { window.location.href = 'landing.html'; return; }
    }
    var chatActorName = chatRole === 'agent' ? chatActor.name : chatActor.name.split(' ')[0];

    document.getElementById('chatRoleBadge').innerHTML = '<span class="dot"></span>' + (chatRole === 'agent' ? 'Agent Console' : 'Customer Portal');
    document.getElementById('chatBackBtn').addEventListener('click', function () {
      window.location.href = chatRole === 'agent' ? 'agent-dashboard.html' : 'portal.html';
    });

    var chatAllTickets = [];
    try { chatAllTickets = JSON.parse(localStorage.getItem('docketTickets')) || []; } catch (e) { chatAllTickets = []; }
    var chatTicket = chatAllTickets.filter(function (t) { return t.id === chatTicketId; })[0];

    var chatInput = document.getElementById('chatInput');
    var chatSendBtn = document.getElementById('chatSendBtn');
    var chatVisibility = 'public';
    var visToggle = document.getElementById('chatVisibilityToggle');

    if (chatRole === 'agent' && visToggle) {
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
          bubble.innerHTML =
            '<span class="chat-name">' + label + '</span>' +
            escapeHtml(m.text) +
            '<span class="chat-time">' + m.time + '</span>';
          chatThread.appendChild(bubble);
        });
        chatThread.scrollTop = chatThread.scrollHeight;
      };

      var sendChatMessage = function () {
        var text = chatInput.value.trim();
        if (!text) return;
        var msgs = loadChatMessages();
        var visibility = (chatRole === 'agent' && chatVisibility === 'internal') ? 'internal' : 'public';
        msgs.push({ from: chatRole, name: chatActorName, text: text, time: formatChatTime(new Date()), visibility: visibility });
        localStorage.setItem(chatKey, JSON.stringify(msgs));
        chatInput.value = '';
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

});
