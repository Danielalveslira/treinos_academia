import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getInstallPlatform,
  isFirefoxDesktop,
  isIosDevice,
  isMacSafari,
  supportsSafariAddToDock,
} from './pwaInstallHelp.js'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const MAC_SAFARI_SONOMA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const MAC_SAFARI_VENTURA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAC_EDGE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
const FIREFOX_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15'
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

test('isIosDevice detects iPhone, iPad (desktop UA) and not macOS/Windows', () => {
  assert.equal(isIosDevice(IPHONE_SAFARI, 'iPhone', 0), true)
  assert.equal(isIosDevice(IPAD_SAFARI, 'MacIntel', 5), true)
  assert.equal(isIosDevice(MAC_SAFARI_SONOMA, 'MacIntel', 0), false)
  assert.equal(isIosDevice(WINDOWS_CHROME, 'Win32', 0), false)
})

test('isMacSafari is true only for real Safari on macOS, not Chrome/Edge/iPad', () => {
  assert.equal(isMacSafari(MAC_SAFARI_SONOMA, 'MacIntel', 0), true)
  assert.equal(isMacSafari(MAC_CHROME, 'MacIntel', 0), false)
  assert.equal(isMacSafari(MAC_EDGE, 'MacIntel', 0), false)
  assert.equal(isMacSafari(IPAD_SAFARI, 'MacIntel', 5), false)
})

test('isFirefoxDesktop excludes Firefox for iOS', () => {
  assert.equal(isFirefoxDesktop(FIREFOX_LINUX, 'Linux x86_64', 0), true)
  assert.equal(isFirefoxDesktop(FIREFOX_IOS, 'iPhone', 0), false)
  assert.equal(isFirefoxDesktop(MAC_CHROME, 'MacIntel', 0), false)
})

test('supportsSafariAddToDock requires Safari 17+ (macOS Sonoma)', () => {
  assert.equal(supportsSafariAddToDock(MAC_SAFARI_SONOMA), true)
  assert.equal(supportsSafariAddToDock(MAC_SAFARI_VENTURA), false)
})

test('getInstallPlatform classifies each case', () => {
  assert.equal(getInstallPlatform(IPHONE_SAFARI, 'iPhone', 0), 'ios')
  assert.equal(getInstallPlatform(IPAD_SAFARI, 'MacIntel', 5), 'ios')
  assert.equal(getInstallPlatform(MAC_SAFARI_SONOMA, 'MacIntel', 0), 'mac-safari')
  assert.equal(getInstallPlatform(FIREFOX_LINUX, 'Linux x86_64', 0), 'firefox')
  assert.equal(getInstallPlatform(MAC_CHROME, 'MacIntel', 0), 'generic')
  assert.equal(getInstallPlatform(WINDOWS_CHROME, 'Win32', 0), 'generic')
})
