<template>
  <v-container
    class="overview-container pa-3"
    :style="{maxWidth: '420px'}">

    <!-- Header: icon + account count + sync all button -->
    <div class="d-flex align-center justify-space-between mb-3">
      <div class="d-flex align-center">
        <v-icon
          color="primary"
          size="22"
          class="mr-2">
          mdi-bookmark-multiple
        </v-icon>
        <span class="overview-subtitle">
          {{ Object.keys(accountData).length }} sync {{ Object.keys(accountData).length === 1 ? 'account' : 'accounts' }}
        </span>
      </div>
      <v-btn
        color="primary"
        elevation="0"
        small
        tile
        @click="clickSyncAll">
        <v-icon
          small
          left>mdi-sync</v-icon>
        {{ t('LabelSyncall') }}
      </v-btn>
    </div>

    <!-- Loading -->
    <template v-if="loading && !Object.keys(accountData).length">
      <div class="d-flex align-center justify-center py-8">
        <v-progress-circular
          indeterminate
          color="primary"
          size="28" />
      </div>
    </template>

    <template v-else>
      <!-- Enabled accounts first -->
      <template v-for="account in accountData">
        <AccountCard
          v-if="account.data.enabled || account.data.syncIntervalEnabled"
          :key="account.id"
          :account="account"
          class="mb-2" />
      </template>

      <!-- Disabled accounts last -->
      <template v-for="account in accountData">
        <AccountCard
          v-if="!account.data.enabled && !account.data.syncIntervalEnabled"
          :key="account.id"
          :account="account"
          class="mb-2" />
      </template>

      <!-- Empty state -->
      <div
        v-if="!Object.keys(accountData).length"
        class="text-center py-8">
        <v-icon
          size="48"
          color="primary"
          style="opacity:0.3"
          class="mb-3">
          mdi-bookmark-off-outline
        </v-icon>
        <div class="text-body-2 font-weight-medium mb-1">
          {{ t('LabelNoAccount') }}
        </div>
        <div class="text-caption grey--text">
          {{ t('DescriptionNoAccount') }}
        </div>
      </div>

      <!-- Bottom action buttons -->
      <v-btn
        block
        color="primary"
        elevation="0"
        small
        tile
        class="mt-2"
        :to="{ name: routes.NEW_ACCOUNT }"
        target="_blank">
        <v-icon
          left
          small>mdi-plus</v-icon>
        {{ t('LabelNewAccount') }}
      </v-btn>
      <v-btn
        block
        elevation="0"
        small
        tile
        outlined
        color="primary"
        class="mt-1"
        :to="{ name: routes.IMPORTEXPORT }"
        target="_blank">
        <v-icon
          left
          small>mdi-transfer</v-icon>
        {{ t('LabelImportExport') }}
      </v-btn>
    </template>
  </v-container>
</template>

<script>
import AccountCard from '../components/AccountCard'
import { routes } from '../router'
import { actions } from '../store/definitions'

export default {
  name: 'Overview',
  components: { AccountCard },
  computed: {
    accountData() {
      return this.$store.state.accounts
    },
    routes() {
      return routes
    },
    loading() {
      return this.$store.state.loading.accounts
    },
  },
  methods: {
    clickSyncAll() {
      this.$store.dispatch(actions.TRIGGER_SYNC_ALL)
    }
  }
}
</script>

<style scoped>
.overview-container {
  padding-bottom: 8px;
}

.overview-subtitle {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.7;
  letter-spacing: 0.01em;
}
</style>
