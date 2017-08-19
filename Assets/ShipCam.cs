using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;

public class ShipCam : MonoBehaviour {

    public string SpaceShipTag = "SpaceShip";
    public float RotationSpeed = 0.5f;

    // Use this for initialization
    void Start () {
		
	}
	
	// Update is called once per frame
	void Update () {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
            s.transform.parent != null &&
            s.transform.parent.GetComponent("Rigidbody") != null
            ).OrderBy(s=> (s.transform.position - transform.position).magnitude);

        transform.position = ships.First().transform.position;
        var target = ships.Skip(1).FirstOrDefault();
        if(target != null)
        {
            var _direction = (target.transform.position - transform.position).normalized;
            var _lookRotation = Quaternion.LookRotation(_direction);
            transform.rotation = Quaternion.Slerp(transform.rotation, _lookRotation, Time.deltaTime * RotationSpeed);
        }

    }
}
