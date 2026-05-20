"use strict";

/**
 * BA Kit (M2) — instance super admin flag on users.
 *
 * A boolean column that gates access to /settings/ba-kit-admin and to every
 * /api/ba-kit/admin/* endpoint on the FastAPI side. Defaults to false; ops
 * promotes accounts via the `promote_admin` CLI (or raw SQL).
 *
 * See spec.md Q11 + Q48.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "users",
        "isInstanceAdmin",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        { transaction }
      );
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("users", "isInstanceAdmin", {
        transaction,
      });
    });
  },
};
