export { IMAPClient, type EmailMessage, type IMAPClientOptions } from './IMAPClient.js';
export {
  EmailService,
  type EmailModifyResult,
  type EmailModifyInput,
  type EmailSendInput,
  type EmailSendResult,
  type EmailAccountListRow,
  type EmailQuery,
  type EmailServiceResult,
} from './EmailService.js';
export { GmailMailAdapter } from './GmailMailAdapter.js';
export { GraphMailAdapter } from './GraphMailAdapter.js';
export {
  MICROSOFT_MAIL_SCOPES,
  GOOGLE_MAIL_SCOPE,
  buildGoogleAuthorizationUrl,
  buildMicrosoftAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  exchangeMicrosoftAuthorizationCode,
  type MicrosoftTokenExchangeResult,
  type GoogleTokenExchangeResult,
} from './oauth/exchange.js';
export { requestMicrosoftDeviceCode, pollMicrosoftDeviceUntilTokens } from './oauth/microsoftDevice.js';
