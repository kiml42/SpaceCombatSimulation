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
        public Texture BorderTexture;
        public Texture PointTexture;

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        public abstract GeneralDatabaseHandler DbHandler { get; }

        protected abstract BaseEvolutionConfig _baseConfig { get; }

        public int GenerationNumber { get { return _baseConfig.GenerationNumber; } }

        public Rect SummaryBox = new Rect(800, 10, 230, 50);

        public abstract IEnumerable<string> Combatants { get; }

        public string MainMenu = "MainMenu";

        protected void QuitToMainMenu()
        {
            DbHandler.SetAutoloadId(null);
            SceneManager.LoadScene(MainMenu);
        }

        private void OnGUI()
        {
            var text = "ID: " + DatabaseId + ", Name: " + _baseConfig.RunName + ", Generation: " + _baseConfig.GenerationNumber + Environment.NewLine +
                "Combatants: " + string.Join(" vs ", Combatants.ToArray());

            GUI.Box(SummaryBox, text);
        }
    }
}
