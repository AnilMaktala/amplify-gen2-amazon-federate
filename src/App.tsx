import { useEffect, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import { fetchUserAttributes, signInWithRedirect } from "aws-amplify/auth";
import config from "../amplifyconfiguration.json";
import "./App.css";

Amplify.configure(config);

function App() {
  const { user, signOut } = useAuthenticator((s) => [s.user, s.signOut]);
  const [attributes, setAttributes] =
    useState<Awaited<ReturnType<typeof fetchUserAttributes>>>();

  useEffect(() => {
    if (user) fetchUserAttributes().then(setAttributes);
  }, [user]);

  return (
    <>
      <h1>Amplify (Gen 2) 🤝 Midway</h1>
      {attributes ? (
        <>
          <p>Hello {attributes.email}</p>
          <button onClick={() => signOut()}>Sign out</button>
        </>
      ) : (
        <button
          onClick={() =>
            signInWithRedirect({ provider: { custom: "AmplifyGen2OIDC" } })
          }
        >
          Sign-in with Midway
        </button>
      )}
    </>
  );
}

export default App;
