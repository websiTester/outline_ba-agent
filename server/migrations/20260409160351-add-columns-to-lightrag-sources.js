'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('lightrag_sources', 'summary', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('lightrag_sources', 'length', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 0,
    });
    await queryInterface.addColumn('lightrag_sources', 'chunks', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 0,
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('lightrag_sources', 'summary');
    await queryInterface.removeColumn('lightrag_sources', 'length');
    await queryInterface.removeColumn('lightrag_sources', 'chunks');
  }
};
