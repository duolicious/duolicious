import { useState } from 'react';
import { AppStoreBadges } from '../../badges/app-store/app-store';
import { LEGAL_LINKS } from '../../../constants/constants';
import type { WebBarFooterProps } from './web-bar-footer';
const twitterIcon = require('../../../assets/social/twitter-white.svg');
const redditIcon = require('../../../assets/social/reddit-white.svg');
const githubIcon = require('../../../assets/social/github-white.svg');

const SOCIAL_LINKS = [
  ['X', 'https://twitter.com/duoliciousapp', twitterIcon],
  ['Reddit', 'https://www.reddit.com/r/duolicious', redditIcon],
  ['GitHub', 'https://github.com/duolicious/duolicious', githubIcon],
] as const;

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
      {SOCIAL_LINKS.map(([label, href, icon]) =>
        <li key={href}>
          <a target="_blank" href={href}>
            <img alt={label} src={icon.uri} style={{ height: '20px' }} />
          </a>
        </li>
      )}
    </ul>
  );
};

const LegalLinks = ({ withSocialLinks }: { withSocialLinks: boolean }) => {
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);

  const links = withSocialLinks
    ? [...LEGAL_LINKS, ...SOCIAL_LINKS]
    : LEGAL_LINKS;

  return (
    <ul
      style={{
        boxSizing: 'border-box',
        flexWrap: 'wrap',
        listStyleType: 'none',
        width: '100%',
        justifyContent: 'center',
        display: 'flex',
        gap: '4px 12px',
        border: 'none',
        padding: '0',
        margin: '0',
      }}
    >
      {links.map(([label, href]) =>
        <li key={href}>
          <a
            target="_blank"
            href={href}
            onMouseEnter={() => setHoveredHref(href)}
            onMouseLeave={() => setHoveredHref(null)}
            style={{
              color: 'white',
              fontFamily: 'MontserratRegular',
              fontSize: '12px',
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

const WebBarFooter = ({
  socialAsLinks = false,
  showStoreBadges = true,
}: WebBarFooterProps) => {
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
      {showStoreBadges && <AppStoreBadges/>}
      {!socialAsLinks && <SocialBadges/>}
      <LegalLinks withSocialLinks={socialAsLinks}/>
    </div>
  );
};

export {
  WebBarFooter,
}
