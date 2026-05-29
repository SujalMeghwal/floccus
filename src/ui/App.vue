<template>
  <v-app
    id="app"
    :style="appStyle">
    <v-banner
      v-if="isBrowser"
      color="primary"
      class="mb-1 mt-3 white--text"
      single-line>
      {{ t('DescriptionDonateintervention') }}
      <template #actions>
        <v-btn
          small
          target="_blank"
          href="https://floccus.org/donate/">
          {{ t('LabelDonate') }}
        </v-btn>
      </template>
    </v-banner>
    <v-main>
      <router-view />
    </v-main>
    <v-footer
      :class="['app-footer', $vuetify.theme.dark ? 'footer-dark' : 'footer-light']"
      app>
      <v-row
        no-gutters
        align="center">
        <v-col class="d-flex align-center">
          <v-btn
            text
            x-small
            href="https://floccus.org"
            target="_blank"
            class="white--text font-weight-medium footer-brand">
            <v-icon
              x-small
              class="mr-1">
              mdi-bookmark-multiple
            </v-icon>
            floccus v{{ VERSION }}
          </v-btn>
          <v-divider
            vertical
            class="mx-1 white footer-divider" />
          <v-tooltip top>
            <template #activator="{ on, attrs }">
              <v-btn
                x-small
                icon
                class="white--text"
                v-bind="attrs"
                :to="{name: routes.DONATE}"
                target="_blank"
                v-on="on">
                <v-icon small>
                  mdi-heart-outline
                </v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelFunddevelopment') }}</span>
          </v-tooltip>
          <v-tooltip top>
            <template #activator="{ on, attrs }">
              <v-btn
                x-small
                icon
                class="white--text"
                v-bind="attrs"
                :to="{name: routes.TELEMETRY}"
                target="_blank"
                v-on="on">
                <v-icon small>
                  {{ telemetryEnabled ? 'mdi-bug-play-outline' : 'mdi-bug-pause-outline' }}
                </v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelTelemetry') }}</span>
          </v-tooltip>
          <v-tooltip top>
            <template #activator="{ on, attrs }">
              <v-btn
                x-small
                icon
                class="white--text"
                v-bind="attrs"
                :to="{name: routes.FEEDBACK}"
                target="_blank"
                v-on="on">
                <v-icon small>
                  mdi-bullhorn-variant-outline
                </v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelGivefeedback') }}</span>
          </v-tooltip>
          <v-tooltip top>
            <template #activator="{ on, attrs }">
              <v-btn
                x-small
                icon
                class="white--text"
                v-bind="attrs"
                target="_blank"
                @click="openInNewTab"
                v-on="on">
                <v-icon small>
                  mdi-open-in-new
                </v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelOpeninnewtab') }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
    </v-footer>
    <v-dialog
      v-model="locked"
      :max-width="480"
      persistent>
      <v-card tile>
        <v-card-title class="d-flex align-center pt-5 pb-2">
          <v-icon
            color="primary"
            class="mr-2">
            mdi-lock-outline
          </v-icon>
          <span class="text-h6">{{ t('LabelUnlock') }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-alert
            v-if="unlockError"
            outlined
            dense
            :icon="false"
            type="error"
            class="mb-4">
            {{ unlockError }}
          </v-alert>
          <v-text-field
            v-model="key"
            :label="t('LabelKey')"
            type="password"
            outlined
            dense
            prepend-inner-icon="mdi-key-variant"
            @keyup.enter="onUnlock" />
          <div class="d-flex flex-row-reverse">
            <v-btn
              color="primary"
              elevation="0"
              @click="onUnlock">
              <v-icon
                left
                small>
                mdi-lock-open-variant-outline
              </v-icon>
              {{ t('LabelUnlock') }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script>
import { version as VERSION } from '../../package.json'
import { actions } from './store/definitions'
import { routes } from './router'
import Controller from '../lib/Controller'
import browser from '../lib/browser-api'
export default {
  name: 'App',
  data() {
    return {
      VERSION,
      key: '',
      unlockError: null,
      telemetryEnabled: false,
    }
  },
  computed: {
    locked() {
      return this.$store.state.locked
    },
    routes() {
      return routes
    },
    appStyle() {
      if (this.$vuetify.theme.dark) {
        return {
          background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)'
        }
      }
      return {
        background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 60%, #dbeafe 100%)'
      }
    }
  },
  async created() {
    if (window.KAGI) {
      browser.storage.local.set({'isOrion': true})
    }

    await Promise.all([
      this.$store.dispatch(actions.LOAD_LOCKED),
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    ])
    const controller = await Controller.getSingleton()
    const unregister = controller.onStatusChange(() =>
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    )
    window.addEventListener('beforeunload', unregister)
    window.addEventListener('beforeunload', unregister)
    window.addEventListener('unload', unregister)
    window.addEventListener('close', unregister)
    const {telemetryEnabled} = await browser.storage.local.get({'telemetryEnabled': false})
    this.telemetryEnabled = telemetryEnabled
  },
  methods: {
    async onUnlock() {
      try {
        await this.$store.dispatch(actions.UNLOCK, this.key)
      } catch (e) {
        this.unlockError = e.message
        this.key = ''
      }
    },
    openInNewTab() {
      browser.tabs.create({url: window.location.href})
    }
  }
}
</script>

<style>
body {
  min-width: 380px;
}

/* tighter footer */
.v-footer {
  padding-top: 4px !important;
  padding-bottom: 4px !important;
  min-height: 32px !important;
}

.app-footer {
  border-top: none !important;
}

.footer-light {
  background: linear-gradient(90deg, #4361ee 0%, #3a86ff 100%) !important;
}

.footer-dark {
  background: linear-gradient(90deg, #1a1f3a 0%, #0d1b2a 100%) !important;
}

.footer-divider {
  opacity: 0.3;
  height: 16px !important;
  align-self: center;
}

.footer-brand {
  letter-spacing: 0.03em !important;
  opacity: 0.95;
}
</style>
