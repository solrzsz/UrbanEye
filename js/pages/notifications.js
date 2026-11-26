(function () {
  'use strict';

  async function renderNotifications() {
    const list = document.getElementById('notificationsList');
    const markReadButton = document.getElementById('markNotificationsRead');
    if (!list) return;
  
    if (!window.UrbanAuth?.isAuthenticated?.()) {
      list.textContent = 'Entre na sua conta para ver atualizações dos seus relatos.';
      if (markReadButton) markReadButton.hidden = true;
      return;
    }
  
    list.textContent = 'Carregando notificações...';
    if (markReadButton) {
      markReadButton.hidden = true;
      markReadButton.disabled = false;
    }
  
    try {
      const notifications = await UrbanAPI.getNotifications();
      const unreadCount = notifications.filter(notification => !notification.read_at).length;
      if (markReadButton) markReadButton.hidden = unreadCount === 0;
      if (!notifications.length) {
        list.textContent = 'Nenhum alerta de atualização ainda. Você receberá um quando a situação de um dos seus relatos mudar.';
        return;
      }
  
      list.replaceChildren();
      notifications.forEach(notification => {
        const item = document.createElement('article');
        item.className = 'listitem';
        item.setAttribute('aria-label', notification.read_at ? 'Notificação lida' : 'Notificação não lida');
  
        const content = document.createElement('div');
        content.style.flex = '1';
        const title = document.createElement('b');
        title.textContent = notification.title;
        const message = document.createElement('p');
        message.className = 'small muted';
        message.textContent = notification.message;
        content.append(title, message);
  
        if (notification.created_at) {
          const date = new Date(notification.created_at);
          if (Number.isFinite(date.getTime())) {
            const time = document.createElement('time');
            time.className = 'small muted';
            time.dateTime = date.toISOString();
            time.textContent = date.toLocaleString('pt-BR');
            content.appendChild(time);
          }
        }
  
        item.appendChild(content);
        list.appendChild(item);
      });
    } catch (error) {
      console.error('Não foi possível carregar as notificações:', error);
      list.textContent = 'Não foi possível carregar notificações. Confira se a migração database/supabase_notifications.sql foi executada no projeto Supabase.';
    }
  }

  async function markNotificationsRead() {
    const button = document.getElementById('markNotificationsRead');
    if (button) button.disabled = true;
    try {
      const count = await UrbanAPI.markNotificationsRead();
      if (button) {
        button.hidden = true;
        button.disabled = false;
      }
      await renderNotifications();
      toast(count ? 'Notificações marcadas como lidas.' : 'Não há notificações novas.');
    } catch (error) {
      console.error('Não foi possível marcar as notificações como lidas:', error);
      toast(error?.message || 'Não foi possível atualizar as notificações.');
      if (button) button.disabled = false;
    }
  }
  
  Object.assign(window, {markNotificationsRead});

  onAppReady(renderNotifications);
})();
