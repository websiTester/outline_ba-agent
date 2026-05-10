"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.dropTable("lightrag_sources");
  },

  down: async (queryInterface, Sequelize) => {
    // We do not recreate it in down as we are dropping it permanently.
    // If needed, the previous migration that originally created it could be re-run manually.
    console.warn("Down migration for dropping lightrag_sources is a no-op");
  },
};
