"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "agent_tools",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: Sequelize.UUIDV4,
          },
          workspaceId: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          sectionId: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          toolName: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          model: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "gemini-2.5-flash",
          },
          toolDescription: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          defaultPrompt: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          instruction: {
            type: Sequelize.TEXT,
            allowNull: false,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("agent_tools", ["workspaceId"], {
        transaction,
      });

      await queryInterface.addIndex(
        "agent_tools",
        ["workspaceId", "sectionId"],
        { unique: true, transaction }
      );
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("agent_tools", { transaction });
    });
  },
};
