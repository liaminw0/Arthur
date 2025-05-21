import React from 'react';

const HomepagePreview = ({ entry, widgetFor }) => {
  const title = entry.getIn(['data', 'title']);
  const logo = entry.getIn(['data', 'logo']);
  const body = widgetFor('body');

  return (
    <section id="homepage-preview">
      <header id="homepage-header">
        {logo ? (
          <img id="homepage-logo" src={logo} alt="Logo preview" />
        ) : null}
        <h1 id="homepage-title">{title}</h1>
      </header>
      <article id="homepage-body">
        {body}
      </article>
    </section>
  );
};

export default HomepagePreview;
