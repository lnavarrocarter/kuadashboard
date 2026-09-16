<template>
  <div class="account-view">
    <div class="account-header">
      <h2 class="account-title">
        <i data-lucide="user"></i>
        {{ t('account.title') }}
      </h2>
    </div>

    <div class="account-body">
      <div v-if="store.status === 'loading' || store.status === 'idle'" class="account-state">
        <i data-lucide="loader" class="spin"></i>
        <span>{{ t('account.loading') }}</span>
      </div>

      <div v-else-if="store.status === 'unavailable'" class="account-state">
        <i data-lucide="cloud-off"></i>
        <span>{{ t('account.unavailable') }}</span>
      </div>

      <div v-else-if="store.status === 'error'" class="account-state account-state-error">
        <i data-lucide="alert-triangle"></i>
        <span>{{ t('account.error') }}: {{ store.error }}</span>
        <button class="btn sm" @click="store.fetchMe()">{{ t('account.retry') }}</button>
      </div>

      <div v-else-if="store.status === 'authenticated'" class="account-signed-in">
        <div class="account-profile">
          <img v-if="store.user?.picture" :src="store.user.picture" class="account-avatar" alt="" />
          <i v-else data-lucide="user-circle" class="account-avatar-fallback"></i>
          <div class="account-profile-info">
            <span class="account-name">{{ store.user?.name }}</span>
            <span class="account-email">{{ store.user?.email }}</span>
          </div>
          <button class="btn sm" @click="store.logout()">
            <i data-lucide="log-out"></i> {{ t('account.signOut') }}
          </button>
        </div>

        <div class="account-plan" v-if="store.entitlements">
          <span :class="['account-plan-badge', `plan-${store.entitlements.plan}`]">
            {{ t(`account.plan.${store.entitlements.plan}`) }}
          </span>
          <ul class="account-features">
            <li v-for="(enabled, feature) in store.entitlements.features" :key="feature" :class="{ 'is-off': !enabled }">
              <i :data-lucide="enabled ? 'check' : 'x'"></i>
              {{ t(`account.feature.${feature}`) }}
            </li>
          </ul>
        </div>
      </div>

      <div v-else class="account-signed-out">
        <p class="account-hint">{{ t('account.signInHint') }}</p>
        <button class="btn primary" @click="store.login()">
          <i data-lucide="log-in"></i> {{ t('account.signInGoogle') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, nextTick, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useAccountStore } from '../stores/useAccountStore'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const store = useAccountStore()

onMounted(() => {
  if (store.status === 'idle') store.fetchMe()
  nextTick(() => createIcons({ icons }))
})

watch(() => [store.status, store.entitlements], () => nextTick(() => createIcons({ icons })))
</script>

<style scoped>
.account-view {
  padding: 20px;
  max-width: 480px;
}
.account-header {
  margin-bottom: 16px;
}
.account-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  margin: 0;
}
.account-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  padding: 16px 0;
}
.account-state-error {
  color: var(--red);
  flex-wrap: wrap;
}
.spin {
  animation: account-spin 1s linear infinite;
}
@keyframes account-spin {
  to { transform: rotate(360deg); }
}

.account-signed-out {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.account-hint {
  color: var(--text-dim);
  margin: 0;
}

.account-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.account-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.account-avatar-fallback {
  width: 40px;
  height: 40px;
  color: var(--text-dim);
}
.account-profile-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.account-name { font-weight: 600; }
.account-email { font-size: 12px; color: var(--text-dim); }

.account-plan {
  border-top: 1px solid var(--border-subtle);
  padding-top: 12px;
}
.account-plan-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  background: var(--bg-subtle);
  color: var(--text-dim);
  margin-bottom: 10px;
}
.account-plan-badge.plan-pro,
.account-plan-badge.plan-team {
  background: var(--accent-dim);
  color: var(--accent);
}
.account-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.account-features li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
}
.account-features li.is-off {
  color: var(--text-muted);
}
.account-features li i {
  width: 14px;
  height: 14px;
}
.account-features li:not(.is-off) i {
  color: var(--green);
}
</style>
