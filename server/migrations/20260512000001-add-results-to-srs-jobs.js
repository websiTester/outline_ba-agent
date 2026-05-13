"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "srs_jobs",
        "results",
        {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        { transaction }
      );
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("srs_jobs", "results", { transaction });
    });
  },
};
