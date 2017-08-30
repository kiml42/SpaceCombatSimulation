using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;

public class ShipCam : MonoBehaviour {

    public string SpaceShipTag = "SpaceShip";
    public float RotationSpeed = 0.5f;
    public float TranslateSpeed = 0.5f;

    // Use this for initialization
    void Start () {
		
	}
	
	// Update is called once per frame
	void Update () {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
                s.transform.parent != null &&
                s.transform.parent.GetComponent("Rigidbody") != null
            )
            .Select(s => s.transform.parent)
            .OrderBy(s=> Vector3.Distance(s.position, transform.position));

        if (ships.FirstOrDefault() != null)
        {
            Transform shipToFollow;
            if (Input.GetKeyUp(KeyCode.Z) && ships.Count() > 1)
            {
                shipToFollow = ships.OrderBy(s => Random.value).First();
                transform.position = shipToFollow.position;
            }
            else
            {
                shipToFollow = ships.First();
                transform.position = Vector3.Slerp(transform.position, ships.First().position, Time.deltaTime * TranslateSpeed);
            }
            
            //retrieve the closest ship with a different tag - prevents following other parts and projectiles from the same ship.
            var target = ships.FirstOrDefault(s => s.tag != shipToFollow.tag);
            if (target != null)
            {
                var _direction = (target.transform.position - transform.position).normalized;
                var _lookRotation = Quaternion.LookRotation(_direction);
                transform.rotation = Quaternion.Slerp(transform.rotation, _lookRotation, Time.deltaTime * RotationSpeed);
            }
            else
            {
                Debug.Log("Camera found no ships to turn to. Tag being followed: " + shipToFollow.tag);
            }
        }

    }
}
