using Assets.Src.Database;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Assets.Src.Evolution
{
    public abstract class BaseEvolutionController : MonoBehaviour
    {
        public int DatabaseId;

        public EvolutionShipConfig ShipConfig;
        protected EvolutionMutationWrapper _mutationControl = new EvolutionMutationWrapper();
        protected EvolutionMatchController _matchControl;

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        public abstract GeneralDatabaseHandler DbHandler { get; }

        protected abstract BaseEvolutionConfig BaseConfig { get; }

        public int GenerationNumber { get { return BaseConfig.GenerationNumber; } }

        public Rect SummaryBox = new Rect(800, 10, 430, 50);

        public abstract IEnumerable<string> Combatants { get; }

        public string MainMenu = "MainMenu";

        protected void QuitToMainMenu()
        {
            DbHandler.SetAutoloadId(null);
            SceneManager.LoadScene(MainMenu);
        }

        private void OnGUI()
        {
            var text = "ID: " + DatabaseId + ", Name: " + BaseConfig.RunName + ", Generation: " + BaseConfig.GenerationNumber + Environment.NewLine +
                "Combatants: " + string.Join(" vs ", Combatants.ToArray());

            var runTimeing = _matchControl.MatchRunTime;
            var matchLength = _matchControl.Config.MatchTimeout;
            var remaining = matchLength - runTimeing;

            text +=Environment.NewLine + Math.Round(remaining) + " seconds remaining";

            GUI.Box(SummaryBox, text);
        }
    }
}
