using Assets.Src.Database;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Menus
{
    public class GenericEvolutionLoadListController : MonoBehaviour
    {
        protected EvolutionDatabaseHandler _handler;
        private Dictionary<int, string> _configs;
        public TextMesh MenuItemPrefab;
        public Transform FirstMenuItemLocation;
        public Transform FirstEditButtonLocation;
        public Vector3 SubsequentItemOffset = new Vector3(0, -1, 0);
        public string RunScene;
        public string EditScene;

        public void Start()
        {
            _handler = new EvolutionDatabaseHandler();

            var autoLoadId = _handler.ReadAutoloadId();
            _configs = _handler.ListConfigs();
            var i = 0;
            foreach (var config in _configs)
            {
                var menuItem = Instantiate(MenuItemPrefab, FirstMenuItemLocation.position + (i * SubsequentItemOffset), FirstMenuItemLocation.rotation, transform);
                menuItem.text = config.Value;
                var menuItemScript = menuItem.GetComponent<MenuItem>();

                menuItemScript.IdToLoad = config.Key;
                menuItemScript.SetIdToLoad = true;
                menuItemScript.SceneToLoad = RunScene;
                if (autoLoadId != null && autoLoadId.Value == config.Key)
                {
                    //This one is the one to load, simulate a click to load the scene.
                    menuItemScript.OnMouseUp();
                }

                var editButton = Instantiate(MenuItemPrefab, FirstEditButtonLocation.position + (i * SubsequentItemOffset), FirstMenuItemLocation.rotation, transform);
                editButton.text = "edit";
                editButton.fontSize = 100;
                var editButtonScript = editButton.GetComponent<MenuItem>();

                editButtonScript.IdToLoad = config.Key;
                editButtonScript.SetIdToLoad = true;
                editButtonScript.SceneToLoad = EditScene;

                i++;
            }
        }
    }
}
