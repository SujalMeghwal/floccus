<template>
  <v-card
    :loading="Boolean(account.data.syncing)"
    :class="['account-card', `account-card--${status}`]"
    tile
    :elevation="status === 'disabled' ? 0 : 1">
    <template #progress>
      <v-progress-linear
        :value="account.data.syncing * 100 || 0"
        color="primary"
        height="2" />
    </template>

    <!-- Row 1: type + folder + status -->
    <div class="account-card__top px-3 pt-3 pb-1 d-flex align-center justify-space-between">
      <div class="d-flex align-center min-w-0 mr-2">
        <v-chip
          x-small
          label
          :color="status === 'disabled' ? 'blue-grey' : 'primary'"
          class="account-card__type-chip mr-2 white--text font-weight-bold flex-shrink-0"
          :outlined="status === 'disabled'">
          <v-icon
            x-small
            left>
            {{ typeIcon }}
          </v-icon>
          {{ account.data.type }}
        </v-chip>
        <v-icon
          size="18"
          :color="status === 'disabled' ? 'blue-grey' : 'primary'"
          class="mr-1 flex-shrink-0">
          {{ account.data.localRoot === 'tabs' ? 'mdi-tab' : 'mdi-folder' }}
        </v-icon>
        <span class="account-card__folder font-weight-semibold text-truncate">{{ folderName }}</span>
      </div>

      <div
        class="account-card__status d-flex align-center flex-shrink-0"
        :style="{color: statusColor}">
        <v-icon
          size="15"
          class="mr-1"
          :class="{'spinning': account.data.syncing}"
          :color="statusColor">
          {{ statusIcon }}
        </v-icon>
        <span class="account-card__status-text font-weight-medium">{{ statusLabel }}</span>
      </div>
    </div>

    <!-- Row 2: uri + last sync detail -->
    <div class="account-card__meta px-3 pb-2 d-flex align-center justify-space-between flex-wrap">
      <span class="account-card__uri text-truncate">{{ uri }}</span>
      <span
        :class="['account-card__detail', account.data.error ? 'error--text' : '']">
        {{ statusDetail }}
      </span>
    </div>

    <!-- Error action buttons -->
    <div
      v-if="account.data.error"
      class="px-3 pb-2 d-flex flex-wrap gap-1">
      <v-btn
        color="error"
        x-small
        outlined
        @click="onGetLogs">
        {{ t('LabelDebuglogs') }}
      </v-btn>
      <v-btn
        color="error"
        x-small
        outlined
        href="https://floccus.org/faq/"
        target="_blank">
        {{ t('LabelFaq') }}
      </v-btn>
      <v-btn
        color="error"
        x-small
        outlined
        href="https://github.com/floccusaddon/floccus/issues"
        target="_blank">
        {{ t('LabelReportproblem') }}
      </v-btn>
    </div>

    <!-- Inline warnings (legacy / failsafe) -->
    <div
      v-if="legacyWarning || !account.data.failsafe"
      class="px-3 pb-1">
      <div
        v-if="legacyWarning"
        class="account-card__warn warning--text text-caption">
        <v-icon
          x-small
          color="warning"
          class="mr-1">mdi-alert-outline</v-icon>{{ legacyWarning }}
      </div>
      <div
        v-if="!account.data.failsafe"
        class="account-card__warn warning--text text-caption">
        <v-icon
          x-small
          color="warning"
          class="mr-1">mdi-alert-outline</v-icon>{{ t('StatusFailsafeoff') }}
      </div>
    </div>

    <!-- Action row -->
    <v-divider />
    <div class="account-card__actions px-2 py-1 d-flex align-center justify-space-between">
      <v-btn
        x-small
        text
        tile
        color="primary"
        :to="{ name: routes.ACCOUNT_OPTIONS, params: { accountId: account.id } }"
        target="_blank">
        <v-icon
          size="16"
          left>mdi-cog-outline</v-icon>
        {{ t('LabelOptions') }}
      </v-btn>

      <div class="d-flex align-center">
        <!-- Scheduled force-sync -->
        <v-btn
          v-if="status === 'scheduled'"
          x-small
          text
          color="info"
          class="mr-1"
          @click="onForceSync">
          {{ t('LabelScheduledforcesync') }}
        </v-btn>

        <!-- Enable sync (disabled state) -->
        <v-btn
          v-if="status === 'disabled'"
          x-small
          color="primary"
          elevation="0"
          class="mr-1"
          @click="onEnableSync">
          <v-icon
            x-small
            left>mdi-sync</v-icon>
          Enable
        </v-btn>

        <v-tooltip top>
          <template #activator="{on, attrs}">
            <v-btn
              icon
              small
              v-bind="attrs"
              :disabled="account.data.syncing || account.data.scheduled"
              v-on="on"
              @click="onTriggerSyncDown">
              <v-icon
                size="18"
                color="#111">mdi-arrow-down-bold</v-icon>
            </v-btn>
          </template>
          <span>{{ t('LabelSyncDownOnce') }}</span>
        </v-tooltip>

        <v-tooltip top>
          <template #activator="{on, attrs}">
            <v-btn
              icon
              small
              v-bind="attrs"
              :disabled="account.data.syncing || account.data.scheduled"
              v-on="on"
              @click="onTriggerSyncUp">
              <v-icon
                size="18"
                color="#111">mdi-arrow-up-bold</v-icon>
            </v-btn>
          </template>
          <span>{{ t('LabelSyncUpOnce') }}</span>
        </v-tooltip>

        <v-btn
          v-if="!account.data.syncing"
          small
          tile
          color="primary"
          elevation="0"
          class="ml-1"
          :disabled="account.data.scheduled"
          @click="onTriggerSync">
          <v-icon
            small
            left>mdi-sync</v-icon>
          {{ t('LabelSyncnow') }}
        </v-btn>
        <v-btn
          v-else
          small
          tile
          outlined
          color="error"
          class="ml-1"
          @click="onCancelSync">
          <v-icon
            small
            left>mdi-cancel</v-icon>
          {{ t('LabelCancelsync') }}
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<script>
import PathHelper from '../../lib/PathHelper'
import { actions } from '../store/definitions'

function shortAge(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
import { routes } from '../router'
import BrowserTree from '../../lib/browser/BrowserTree'

export default {
  name: 'AccountCard',
  props: {
    account: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      rootPath: '',
      statusColors: {
        disabled: '#90a4ae',
        ok: '#2d9e5f',
        error: '#d62828',
        syncing: '#4361ee',
        scheduled: '#4895ef',
      },
      statusIcons: {
        disabled: 'mdi-sync-off',
        ok: 'mdi-check-circle-outline',
        error: 'mdi-alert-circle-outline',
        syncing: 'mdi-sync',
        scheduled: 'mdi-timer-sync-outline',
      },
      statusLabels: {
        disabled: this.t('StatusDisabled'),
        ok: this.t('StatusAllgood'),
        error: this.t('StatusError'),
        syncing: this.t('StatusSyncing'),
        scheduled: this.t('StatusScheduled'),
      },
      typeIcons: {
        'git': 'mdi-git',
        'webdav': 'mdi-cloud',
        'nextcloud-bookmarks': 'mdi-cloud',
        'nextcloud-folders': 'mdi-cloud',
        'google-drive': 'mdi-google-drive',
        'dropbox': 'mdi-dropbox',
        'linkwarden': 'mdi-link',
        'karakeep': 'mdi-bookmark',
      },
    }
  },
  computed: {
    folderName() {
      const pathArray = PathHelper.pathToArray(
        this.rootPath || this.t('LabelRootfolder')
      )
      return pathArray[pathArray.length - 1] || this.t('LabelUntitledfolder')
    },
    localRoot() {
      return this.account.data.localRoot
    },
    uri() {
      return this.account.label
    },
    typeIcon() {
      return this.typeIcons[this.account.data.type] || 'mdi-sync'
    },
    status() {
      if (this.account.data.syncing) return 'syncing'
      if (this.account.data.scheduled) return 'scheduled'
      if (this.account.data.error) return 'error'
      if (!this.account.data.enabled && !this.account.data.syncIntervalEnabled && !this.account.data.syncOnStartupEnabled) return 'disabled'
      return 'ok'
    },
    statusIcon() {
      return this.statusIcons[this.status]
    },
    statusColor() {
      return this.statusColors[this.status]
    },
    statusLabel() {
      return this.statusLabels[this.status]
    },
    statusDetail() {
      if (this.account.data.error) {
        return this.account.data.error
      }
      if (this.account.data.syncing) return 'Syncing...'
      if (this.account.data.scheduled) return 'Scheduled'
      if (this.status === 'disabled') return 'Sync off — click Enable'
      if (this.account.data.lastSync) {
        return `Synced ${shortAge(Date.now() - this.account.data.lastSync)}`
      }
      return 'Never synced'
    },
    legacyWarning() {
      if (this.account.data.type === 'nextcloud' || this.account.data.type === 'nextcloud-legacy') {
        return this.t('LegacyAdapterDeprecation')
      }
      return null
    },
    routes() {
      return routes
    },
  },
  watch: {
    async localRoot(localRoot) {
      this.rootPath = await BrowserTree.getPathFromLocalId(localRoot)
    },
  },
  async created() {
    this.rootPath = await BrowserTree.getPathFromLocalId(this.localRoot)
  },
  methods: {
    onTriggerSync() {
      this.$store.dispatch(actions.TRIGGER_SYNC, this.account.id)
    },
    onTriggerSyncUp() {
      this.$store.dispatch(actions.TRIGGER_SYNC_UP, this.account.id)
    },
    onTriggerSyncDown() {
      this.$store.dispatch(actions.TRIGGER_SYNC_DOWN, this.account.id)
    },
    onCancelSync() {
      this.$store.dispatch(actions.CANCEL_SYNC, this.account.id)
    },
    onGetLogs() {
      this.$store.dispatch(actions.DOWNLOAD_LOGS)
    },
    onForceSync() {
      if (confirm(this.t('DescriptionScheduledforcesync'))) {
        this.$store.dispatch(actions.FORCE_SYNC, this.account.id)
      }
    },
    onEnableSync() {
      this.$store.dispatch(actions.STORE_ACCOUNT, {
        id: this.account.id,
        data: {...this.account.data, enabled: true, syncIntervalEnabled: true}
      })
    }
  }
}
</script>

<style scoped>
.account-card {
  transition: box-shadow 0.18s ease;
  overflow: hidden;
  border-radius: 0 !important;
}

.account-card--disabled {
  opacity: 0.75;
}

.account-card--error {
  border-left: 3px solid #d62828 !important;
}

.account-card--ok {
  border-left: 3px solid #2d9e5f !important;
}

.account-card--syncing {
  border-left: 3px solid #4361ee !important;
}

.account-card--scheduled {
  border-left: 3px solid #4895ef !important;
}

.account-card--disabled {
  border-left: 3px solid #90a4ae !important;
}

.account-card__type-chip {
  font-size: 11px !important;
  height: 20px !important;
  letter-spacing: 0.03em;
  border-radius: 2px !important;
}

.account-card__folder {
  font-size: 1.05rem !important;
  font-weight: 700 !important;
  line-height: 1.2;
}

.account-card__status-text {
  font-size: 13px !important;
  font-weight: 600 !important;
  letter-spacing: 0.02em;
}

.account-card__uri {
  font-size: 13px !important;
  font-weight: 600;
  color: #111 !important;
  max-width: 45%;
}

.account-card__detail {
  font-size: 13px !important;
  font-weight: 500;
  color: #111 !important;
  max-width: 58%;
  text-align: right;
}

.account-card__warn {
  font-size: 12px !important;
  line-height: 1.4;
}

.account-card__actions {
  min-height: 36px;
}

.gap-1 > * + * {
  margin-left: 4px;
}

.spinning {
  animation: spin 1.2s infinite linear;
}

@media (min-width: 420px) {
  .account-card__statusColumn {
    min-width: max-content;
  }
}

@media (max-width: 419px) {
  .account-card__header {
    flex-direction: column;
  }
  .account-card__footer {
    flex-direction: column !important;
  }
  .account-card__actions {
    flex-direction: column !important;
  }
  .account-card__actions .ml-0 {
    margin-left: 4px !important;
  }
  .account-card__options {
    flex-direction: column !important;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.font-weight-semibold {
  font-weight: 600 !important;
}

.min-w-0 {
  min-width: 0;
}
</style>
