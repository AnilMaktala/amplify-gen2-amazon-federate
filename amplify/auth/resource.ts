import { defineAuth, secret } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      oidc: [
        {
          name: "AmplifyGen2OIDC",
          // Provide the client ID obtained from the Amazon Federate Service Profile
          clientId: secret("GEN2_OIDC_CLIENT_ID"),
          // Provide the client secret obtained from the Amazon Federate Service Profile
          clientSecret: secret("GEN2_OIDC_CLIENT_SECRET"),
          // The issuer URL for the Amazon Federate identity provider
          issuerUrl: "https://idp-integ.federate.amazon.com",
          // The scopes required for the authentication flow
          scopes: [
            "openid",
            "aws.cognito.signin.user.admin",
            "email",
            "profile",
            "phone",
          ],
          // Mapping of user attributes from the identity provider to Cognito User Pool
          attributeMapping: {
            email: {
              attributeName: "email",
            },
          },
        },
      ],
      // The redirect URLs for the authentication flow
      callbackUrls: [
        "http://localhost:5173",
        "https://main.d25d1r2idtfra3.amplifyapp.com/",
      ],
      logoutUrls: [
        "http://localhost:5173",
        "https://main.d25d1r2idtfra3.amplifyapp.com/",
      ],
      // This required value will be prepended to `.auth.us-west-2.amazoncognito.com` and used for your application's OAuth URL
      domainPrefix: "amplifygen4",
    },
  },
});
