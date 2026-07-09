export interface GraphMailMessage {
  to: string[];
  subject: string;
  bodyText: string;
}

export interface TeamsChannelMessage {
  teamId: string;
  channelId: string;
  bodyText: string;
}

export interface NotificationSender {
  sendMail(message: GraphMailMessage): Promise<void>;
  postTeamsChannelMessage?(message: TeamsChannelMessage): Promise<void>;
}

interface GraphAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function graphAuthConfig(): GraphAuthConfig {
  return {
    tenantId: requireEnv("GRAPH_TENANT_ID"),
    clientId: requireEnv("GRAPH_CLIENT_ID"),
    clientSecret: requireEnv("GRAPH_CLIENT_SECRET")
  };
}

async function graphAccessToken(): Promise<string> {
  const config = graphAuthConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error(`Graph token request failed with HTTP ${response.status}.`);
  }
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Graph token response did not include access_token.");
  return payload.access_token;
}

async function graphPost(path: string, token: string, body: unknown): Promise<void> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Graph POST ${path} failed with HTTP ${response.status}.`);
  }
}

function textToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

export function createGraphSenderFromEnv(): NotificationSender {
  const senderUserId = requireEnv("GRAPH_MAIL_SENDER_USER_ID");
  return {
    async sendMail(message: GraphMailMessage): Promise<void> {
      const token = await graphAccessToken();
      await graphPost(`/users/${encodeURIComponent(senderUserId)}/sendMail`, token, {
        message: {
          subject: message.subject,
          body: {
            contentType: "HTML",
            content: textToHtml(message.bodyText)
          },
          toRecipients: message.to.map(address => ({
            emailAddress: { address }
          }))
        },
        saveToSentItems: false
      });
    },
    async postTeamsChannelMessage(message: TeamsChannelMessage): Promise<void> {
      const token = await graphAccessToken();
      await graphPost(
        `/teams/${encodeURIComponent(message.teamId)}/channels/${encodeURIComponent(message.channelId)}/messages`,
        token,
        {
          body: {
            contentType: "html",
            content: textToHtml(message.bodyText)
          }
        }
      );
    }
  };
}
