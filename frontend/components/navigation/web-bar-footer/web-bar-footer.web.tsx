import { useState } from 'react';
import { AppStoreBadges } from '../../badges/app-store/app-store';
const twitterIcon = require('../../../assets/social/twitter-white.svg');
const redditIcon = require('../../../assets/social/reddit-white.svg');
const githubIcon = require('../../../assets/social/github-white.svg');

const SocialBadges = () => {
  return (
    <ul
      style={{
        boxSizing: 'border-box',
        flexWrap: 'wrap',
        listStyleType: 'none',
        width: '100%',
        justifyContent: 'center',
        display: 'flex',
        gap: '24px',
        border: 'none',
        padding: '0',
        marginTop: 8,
        marginBottom: 8,
      }}
    >
      <li>
        <a target="_blank" href="https://twitter.com/duoliciousapp">
          <img src={twitterIcon.uri} style={{ height: '20px' }} />
        </a>
      </li>
      <li>
        <a target="_blank" href="https://www.reddit.com/r/duolicious">
          <img src={redditIcon.uri} style={{ height: '20px' }} />
        </a>
      </li>
      <li>
        <a target="_blank" href="https://github.com/duolicious/duolicious">
          <img src={githubIcon.uri} style={{ height: '20px' }} />
        </a>
      </li>
    </ul>
  );
};

const LegalLinks = () => {
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);

  return (
    <ul
      style={{
        boxSizing: 'border-box',
        flexWrap: 'wrap',
        listStyleType: 'none',
        width: '100%',
        justifyContent: 'center',
        display: 'flex',
        gap: '12px',
        border: 'none',
        padding: '0',
        margin: '0',
      }}
    >
      {[
        ['Guidelines', '/guidelines/'],
        ['Terms', '/terms/'],
        ['Privacy', '/privacy/'],
      ].map(([label, href]) =>
        <li key={href}>
          <a
            target="_blank"
            href={href}
            onMouseEnter={() => setHoveredHref(href)}
            onMouseLeave={() => setHoveredHref(null)}
            style={{
              color: 'white',
              fontFamily: 'MontserratSemiBold',
              fontSize: '15px',
              textDecoration: hoveredHref === href ? 'underline' : 'none',
            }}
          >
            {label}
          </a>
        </li>
      )}
    </ul>
  );
};

const WebBarFooter = () => {
  return (
    <div
      style={{
        width: '100%',
        marginLeft: '15px',
        marginRight: '15px',
        justifyContent: 'center',
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AppStoreBadges/>
      <SocialBadges/>
      <LegalLinks/>
    </div>
  );
};

export {
  WebBarFooter,
}
